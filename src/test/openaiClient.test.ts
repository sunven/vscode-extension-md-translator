import { strict as assert } from 'assert'
import { decodeAssistantContent, parseTranslationResponse, TranslationClientError } from '../openaiClient'

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
})
