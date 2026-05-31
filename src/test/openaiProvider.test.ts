import { strict as assert } from 'assert'
import { OpenAITranslationOptions } from '../openaiClient'
import { translateBatchWithRecovery } from '../openaiProvider'
import { TranslationClientError, TranslationSegmentInput } from '../translationShared'

const options: OpenAITranslationOptions = {
  apiBaseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'gpt-test',
  temperature: 0.2,
  targetLanguage: 'Simplified Chinese',
  maxResponseTokens: 4000,
  requestTimeoutMs: 1000,
  useJsonResponseFormat: false,
  disableThinking: true
}

describe('openaiProvider recovery', () => {
  it('returns translations without retrying on success', async () => {
    let calls = 0
    const translate = async (_options: OpenAITranslationOptions, batch: TranslationSegmentInput[]) => {
      calls += 1
      return new Map(batch.map(segment => [segment.id, '你好']))
    }

    const result = await translateBatchWithRecovery(translate, options, [{ id: 's1', text: 'hi' }])

    assert.equal(calls, 1)
    assert.equal(result.get('s1'), '你好')
  })

  it('retries then isolates segments when a batch fails with a recoverable error', async () => {
    const segments = [
      { id: 's1', text: 'First.' },
      { id: 's2', text: 'Second.' },
      { id: 's3', text: 'Third.' }
    ]
    const callSizes: number[] = []
    const reporterCalls: string[] = []
    let failedBatchAttempts = 0

    const translate = async (_options: OpenAITranslationOptions, batch: TranslationSegmentInput[]) => {
      callSizes.push(batch.length)

      if (batch.length > 1 && failedBatchAttempts < 2) {
        failedBatchAttempts += 1
        throw new TranslationClientError('Provider returned conflicting translation for segment id: s2')
      }

      return new Map(batch.map(segment => [segment.id, `译文-${segment.id}`]))
    }

    const result = await translateBatchWithRecovery(translate, options, segments, {
      onRetry: () => reporterCalls.push('retry'),
      onSingleSegmentFallbackStart: () => reporterCalls.push('fallback-start'),
      onSingleSegmentFallbackProgress: (index, count) => reporterCalls.push(`progress-${index}-${count}`)
    })

    assert.deepEqual(callSizes, [3, 3, 1, 1, 1])
    assert.deepEqual(reporterCalls, ['retry', 'fallback-start', 'progress-0-3', 'progress-1-3', 'progress-2-3'])
    assert.equal(result.get('s2'), '译文-s2')
  })

  it('throws a single-segment error when the isolated retry still fails', async () => {
    const segments = [
      { id: 's1', text: 'First.' },
      { id: 's2', text: 'Second.' }
    ]
    let failedBatchAttempts = 0

    const translate = async (_options: OpenAITranslationOptions, batch: TranslationSegmentInput[]) => {
      if (batch.length > 1 && failedBatchAttempts < 2) {
        failedBatchAttempts += 1
        throw new TranslationClientError('Provider returned conflicting translation for segment id: s2')
      }

      if (batch[0]?.id === 's2') {
        throw new TranslationClientError('Provider response is missing segment id: s2')
      }

      return new Map(batch.map(segment => [segment.id, `译文-${segment.id}`]))
    }

    await assert.rejects(
      () => translateBatchWithRecovery(translate, options, segments),
      /Single-segment retry failed for s2: Provider response is missing segment id: s2/
    )
  })

  it('rethrows when the error is not recoverable by single-segment fallback', async () => {
    const segments = [
      { id: 's1', text: 'First.' },
      { id: 's2', text: 'Second.' }
    ]

    const translate = async () => {
      throw new TranslationClientError('Provider request failed (500).', 500)
    }

    await assert.rejects(
      () => translateBatchWithRecovery(translate, options, segments),
      /Provider request failed \(500\)/
    )
  })
})
