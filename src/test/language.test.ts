import { strict as assert } from 'assert'
import { targetCodeFor } from '../language'
import { resolveProvider } from '../translationProvider'

describe('language + provider resolution', () => {
  it('maps known language names to ISO codes', () => {
    assert.equal(targetCodeFor('Simplified Chinese'), 'zh-CN')
    assert.equal(targetCodeFor('simplified chinese'), 'zh-CN')
    assert.equal(targetCodeFor('Traditional Chinese'), 'zh-TW')
    assert.equal(targetCodeFor('English'), 'en')
    assert.equal(targetCodeFor('Japanese'), 'ja')
  })

  it('accepts a language code entered directly', () => {
    assert.equal(targetCodeFor('zh-CN'), 'zh-CN')
  })

  it('throws a clear error for an unmappable language name', () => {
    assert.throws(() => targetCodeFor('Klingon'), /Cannot map target language "Klingon"/)
  })

  it('resolves each provider id to a provider with a matching id', () => {
    assert.equal(resolveProvider('ai').id, 'ai')
    assert.equal(resolveProvider('ai').requiresApiKey, true)
    assert.equal(resolveProvider('google').id, 'google')
    assert.equal(resolveProvider('google').requiresApiKey, false)
    assert.equal(resolveProvider('microsoft').id, 'microsoft')
    assert.equal(resolveProvider('microsoft').requiresApiKey, false)
  })

  it('throws for an unknown provider id', () => {
    assert.throws(() => resolveProvider('deepl' as never), /Unknown translation provider: deepl/)
  })
})
