import { OpenAITranslationOptions, translateSegmentsWithOpenAI } from './openaiClient'
import type {
  ProviderTranslationContext,
  TranslationProvider,
  TranslationRecoveryReporter
} from './translationProvider'
import { TranslationClientError, TranslationSegmentInput } from './translationShared'

class OpenAIProvider implements TranslationProvider {
  readonly id = 'ai' as const
  readonly requiresApiKey = true

  async translateSegments(
    segments: TranslationSegmentInput[],
    context: ProviderTranslationContext
  ): Promise<Map<string, string>> {
    const options: OpenAITranslationOptions = {
      apiBaseUrl: context.settings.apiBaseUrl,
      apiKey: context.apiKey ?? '',
      model: context.settings.model,
      temperature: context.settings.temperature,
      targetLanguage: context.settings.targetLanguage,
      maxResponseTokens: context.settings.maxResponseTokens,
      requestTimeoutMs: context.settings.requestTimeoutMs,
      useJsonResponseFormat: context.settings.useJsonResponseFormat,
      disableThinking: context.settings.disableThinking,
      forceTranslate: context.settings.forceTranslate
    }

    return translateBatchWithRecovery(translateSegmentsWithOpenAI, options, segments, context.reporter)
  }
}

export const openAIProvider: TranslationProvider = new OpenAIProvider()

export async function translateBatchWithRecovery(
  translateSegments: typeof translateSegmentsWithOpenAI,
  options: OpenAITranslationOptions,
  segments: TranslationSegmentInput[],
  reporter?: TranslationRecoveryReporter
): Promise<Map<string, string>> {
  try {
    return await translateSegments(options, segments)
  } catch (firstError) {
    reporter?.onRetry(firstError)

    try {
      return await translateSegments(options, segments)
    } catch (retryError) {
      if (!canRecoverBySingleSegmentFallback(retryError, segments)) {
        throw retryError
      }

      reporter?.onSingleSegmentFallbackStart(retryError)
      const recovered = new Map<string, string>()

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        let segmentTranslations: Map<string, string>
        reporter?.onSingleSegmentFallbackProgress(index, segments.length)

        try {
          segmentTranslations = await translateSegments(options, [segment])
        } catch (segmentError) {
          throw buildSingleSegmentFallbackError(segmentError, segment.id)
        }

        for (const [id, translatedText] of segmentTranslations) {
          recovered.set(id, translatedText)
        }
      }

      return recovered
    }
  }
}

function canRecoverBySingleSegmentFallback(error: unknown, segments: TranslationSegmentInput[]): boolean {
  if (segments.length <= 1 || !(error instanceof TranslationClientError)) {
    return false
  }

  return [
    'Provider returned conflicting translation for segment id:',
    'Provider response is missing segment id:',
    'Provider returned unknown segment id:',
    'Provider returned invalid JSON:',
    'Provider response must contain a translations array.',
    'Provider response did not contain a JSON object.'
  ].some(message => error.message.includes(message))
}

function buildSingleSegmentFallbackError(error: unknown, segmentId: string): TranslationClientError {
  const message = error instanceof Error ? error.message : 'Unknown provider error.'
  const status = error instanceof TranslationClientError ? error.status : undefined

  return new TranslationClientError(
    `Single-segment retry failed for ${segmentId}: ${message}`,
    status
  )
}
