import { strict as assert } from 'assert'
import { applyDisableThinkingHint, decodeAssistantContent, parseTranslationResponse, translateSegmentsWithOpenAI } from '../openaiClient'

describe('openaiClient', () => {
  it('parses valid translation JSON from plain content', () => {
    const translations = parseTranslationResponse(
      '{"translations":[{"id":"s1","text":"你好"},{"id":"s2","text":"世界"}]}',
      ['s1', 's2']
    )

    assert.equal(translations.get('s1'), '你好')
    assert.equal(translations.get('s2'), '世界')
  })

  it('extracts valid translation JSON from markdown fences', () => {
    const translations = parseTranslationResponse(
      '```json\n{"translations":[{"id":"s1","text":"你好"}]}\n```',
      ['s1']
    )

    assert.equal(translations.get('s1'), '你好')
  })

  it('rejects duplicate ids', () => {
    assert.throws(
      () => parseTranslationResponse(
        '{"translations":[{"id":"s1","text":"你好"},{"id":"s1","text":"世界"}]}',
        ['s1']
      ),
      /conflicting translation for segment id: s1/
    )
  })

  it('accepts exact duplicate ids when the provider repeats the same translation', () => {
    const translations = parseTranslationResponse(
      '{"translations":[{"id":"s1","text":"你好"},{"id":"s1","text":"你好"}]}',
      ['s1']
    )

    assert.equal(translations.get('s1'), '你好')
  })

  it('rejects missing ids', () => {
    assert.throws(
      () => parseTranslationResponse(
        '{"translations":[{"id":"s1","text":"你好"}]}',
        ['s1', 's2']
      ),
      /missing segment id: s2/
    )
  })

  it('rejects unknown ids', () => {
    assert.throws(
      () => parseTranslationResponse(
        '{"translations":[{"id":"s1","text":"你好"},{"id":"s3","text":"世界"}]}',
        ['s1']
      ),
      /unknown segment id: s3/
    )
  })

  it('normalizes accidental newlines inside translated segment values', () => {
    const translations = parseTranslationResponse(
      '{"translations":[{"id":"s1","text":"  你好\\n世界  "}]}',
      ['s1']
    )

    assert.equal(translations.get('s1'), '你好 世界')
  })

  it('decodes SSE-style assistant content when providers stream data lines', () => {
    const streamed = [
      'data: {"choices":[{"delta":{"content":"{"}}]}',
      'data: {"choices":[{"delta":{"content":"\\"translations\\":["}}]}',
      'data: {"choices":[{"delta":{"content":"{\\"id\\":\\"s1\\",\\"text\\":\\"你好\\"}"}}]}',
      'data: {"choices":[{"delta":{"content":"]}"}}]}',
      'data: [DONE]'
    ].join('\n')

    const content = decodeAssistantContent(streamed, 'text/event-stream')
    const translations = parseTranslationResponse(content, ['s1'])

    assert.equal(translations.get('s1'), '你好')
  })

  it('adds the DeepSeek thinking disable hint when configured', () => {
    const requestBody: Record<string, unknown> = {}

    applyDisableThinkingHint(requestBody, {
      apiBaseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash'
    })

    assert.deepEqual(requestBody.thinking, { type: 'disabled' })
  })

  it('adds the Qwen thinking disable hint when configured', () => {
    const requestBody: Record<string, unknown> = {}

    applyDisableThinkingHint(requestBody, {
      apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-max'
    })

    assert.equal(requestBody.enable_thinking, false)
  })

  it('adds the OpenAI reasoning disable hint only for GPT-5.1 and newer', () => {
    const requestBody: Record<string, unknown> = {}

    applyDisableThinkingHint(requestBody, {
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.1'
    })

    assert.equal(requestBody.reasoning_effort, 'none')
  })

  it('does not add unsupported OpenAI reasoning hints to earlier reasoning models', () => {
    const requestBody: Record<string, unknown> = {}

    applyDisableThinkingHint(requestBody, {
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'o3-mini'
    })

    assert.deepEqual(requestBody, {})
  })

  it('does not add provider-specific thinking fields for unknown providers', () => {
    const requestBody: Record<string, unknown> = {}

    applyDisableThinkingHint(requestBody, {
      apiBaseUrl: 'https://example.test/v1',
      model: 'custom-flash'
    })

    assert.deepEqual(requestBody, {})
  })

  it('adds force-translate instructions on unchanged retry requests', async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: Record<string, unknown> | undefined

    globalThis.fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))

      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '{"translations":[{"id":"s1","text":"你好"}]}'
          }
        }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    }

    try {
      await translateSegmentsWithOpenAI({
        apiBaseUrl: 'https://example.test/v1',
        apiKey: 'test-key',
        model: 'gpt-test',
        temperature: 0.2,
        targetLanguage: 'Simplified Chinese',
        maxResponseTokens: 4000,
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false,
        disableThinking: false,
        forceTranslate: true
      }, [{ id: 's1', text: 'hello' }])
    } finally {
      globalThis.fetch = originalFetch
    }

    const messages = capturedBody?.messages as Array<{ role: string; content: string }>
    const systemMessage = messages.find(message => message.role === 'system')?.content ?? ''

    assert.match(systemMessage, /previous attempt returned unchanged source text/)
    assert.match(systemMessage, /Do not copy an entire source segment/)
    assert.match(systemMessage, /Simplified Chinese/)
  })
})
