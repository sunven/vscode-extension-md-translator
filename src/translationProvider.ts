import type { ProviderId, TranslationSettings } from './config'
import type { TranslationSegmentInput } from './translationShared'
import { googleProvider } from './googleClient'
import { microsoftProvider } from './microsoftClient'
import { openAIProvider } from './openaiProvider'

export interface TranslationRecoveryReporter {
  onRetry(error: unknown): void
  onSingleSegmentFallbackStart(error: unknown): void
  onSingleSegmentFallbackProgress(segmentIndex: number, segmentCount: number): void
}

export interface ProviderTranslationContext {
  settings: TranslationSettings & { forceTranslate?: boolean }
  apiKey?: string
  reporter?: TranslationRecoveryReporter
}

export interface TranslationProvider {
  readonly id: ProviderId
  readonly requiresApiKey: boolean
  translateSegments(
    segments: TranslationSegmentInput[],
    context: ProviderTranslationContext
  ): Promise<Map<string, string>>
}

export function resolveProvider(id: ProviderId): TranslationProvider {
  switch (id) {
    case 'google':
      return googleProvider
    case 'microsoft':
      return microsoftProvider
    case 'ai':
      return openAIProvider
    default:
      throw new Error(`Unknown translation provider: ${id}`)
  }
}
