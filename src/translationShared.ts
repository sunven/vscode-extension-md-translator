export interface TranslationSegmentInput {
  id: string
  text: string
}

export class TranslationClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'TranslationClientError'
  }
}

export function normalizeTranslatedText(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim()
}

export function zipByIndex(
  segments: TranslationSegmentInput[],
  translatedTexts: string[]
): Map<string, string> {
  if (translatedTexts.length !== segments.length) {
    throw new TranslationClientError(
      `Provider returned ${translatedTexts.length} translations for ${segments.length} segments.`
    )
  }

  const translations = new Map<string, string>()

  for (let index = 0; index < segments.length; index += 1) {
    translations.set(segments[index].id, normalizeTranslatedText(translatedTexts[index]))
  }

  return translations
}
