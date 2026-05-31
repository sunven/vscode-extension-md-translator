import { targetCodeFor } from './language'
import type { ProviderTranslationContext, TranslationProvider } from './translationProvider'
import { TranslationClientError, TranslationSegmentInput, zipByIndex } from './translationShared'

// Free, unofficial Microsoft Edge translator endpoints (same as read-frog).
// A short-lived bearer token is fetched from the edge auth endpoint; no user
// API key is required. These endpoints can rate-limit or change without notice.
const MICROSOFT_AUTH_URL = 'https://edge.microsoft.com/translate/auth'
const MICROSOFT_TRANSLATE_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate'
const MICROSOFT_TOKEN_TTL_MS = 8 * 60 * 1000

let cachedToken: { token: string; expiresAt: number } | undefined

class MicrosoftProvider implements TranslationProvider {
  readonly id = 'microsoft' as const
  readonly requiresApiKey = false

  async translateSegments(
    segments: TranslationSegmentInput[],
    context: ProviderTranslationContext
  ): Promise<Map<string, string>> {
    if (segments.length === 0) {
      return new Map()
    }

    const targetCode = targetCodeFor(context.settings.targetLanguage)
    const translatedTexts = await microsoftTranslateBatch(
      segments.map(segment => segment.text),
      '',
      targetCode,
      context.settings.requestTimeoutMs
    )

    return zipByIndex(segments, translatedTexts)
  }
}

export const microsoftProvider: TranslationProvider = new MicrosoftProvider()

export async function microsoftTranslateBatch(
  texts: string[],
  fromLang: string,
  toLang: string,
  requestTimeoutMs: number
): Promise<string[]> {
  const token = await getMicrosoftToken(requestTimeoutMs)

  try {
    return await translateWithToken(texts, fromLang, toLang, token, requestTimeoutMs)
  } catch (error) {
    // The cached token may have expired early; refresh once and retry.
    if (error instanceof TranslationClientError && error.status === 401) {
      const refreshed = await getMicrosoftToken(requestTimeoutMs, true)
      return translateWithToken(texts, fromLang, toLang, refreshed, requestTimeoutMs)
    }

    throw error
  }
}

export function resetMicrosoftTokenCache(): void {
  cachedToken = undefined
}

async function getMicrosoftToken(requestTimeoutMs: number, forceRefresh = false): Promise<string> {
  const now = Date.now()

  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

  try {
    const response = await fetch(MICROSOFT_AUTH_URL, { signal: controller.signal })

    if (!response.ok) {
      throw new TranslationClientError(
        `Failed to get Microsoft translation token (${response.status} ${response.statusText}).`,
        response.status
      )
    }

    const token = (await response.text()).trim()

    if (!token) {
      throw new TranslationClientError('Microsoft translation token endpoint returned an empty token.')
    }

    cachedToken = { token, expiresAt: now + MICROSOFT_TOKEN_TTL_MS }
    return token
  } catch (error) {
    if (error instanceof TranslationClientError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new TranslationClientError('Microsoft translation token request timed out.')
    }

    throw new TranslationClientError(
      error instanceof Error ? `Error refreshing Microsoft token: ${error.message}` : 'Unknown Microsoft token error.'
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function translateWithToken(
  texts: string[],
  fromLang: string,
  toLang: string,
  token: string,
  requestTimeoutMs: number
): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
  const params = new URLSearchParams({
    from: fromLang,
    to: toLang,
    'api-version': '3.0'
  })

  try {
    const response = await fetch(`${MICROSOFT_TRANSLATE_URL}?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': token,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(texts.map(text => ({ Text: text }))),
      signal: controller.signal
    })

    const responseText = await response.text()

    if (!response.ok) {
      throw new TranslationClientError(
        buildMicrosoftErrorMessage(response.status, responseText),
        response.status
      )
    }

    return parseMicrosoftResponse(responseText)
  } catch (error) {
    if (error instanceof TranslationClientError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new TranslationClientError('Microsoft translation request timed out.')
    }

    throw new TranslationClientError(
      error instanceof Error
        ? `Network error during Microsoft translation: ${error.message}`
        : 'Unknown Microsoft translation error.'
    )
  } finally {
    clearTimeout(timeout)
  }
}

function parseMicrosoftResponse(responseText: string): string[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(responseText)
  } catch (error) {
    throw new TranslationClientError(
      `Microsoft translation returned invalid JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`
    )
  }

  if (!Array.isArray(parsed)) {
    throw new TranslationClientError('Unexpected response format from Microsoft translation API.')
  }

  return parsed.map((item, index) => {
    const text = (item as { translations?: Array<{ text?: unknown }> })?.translations?.[0]?.text

    if (typeof text !== 'string') {
      throw new TranslationClientError(`Microsoft translation response is missing translation at index ${index}.`)
    }

    return text
  })
}

function buildMicrosoftErrorMessage(status: number, responseText: string): string {
  const trimmed = responseText.trim().slice(0, 300)
  return trimmed
    ? `Microsoft translation request failed (${status}): ${trimmed}`
    : `Microsoft translation request failed (${status}).`
}
