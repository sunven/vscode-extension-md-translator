import { strict as assert } from 'assert'
import { googleProvider } from '../googleClient'
import type { ProviderTranslationContext } from '../translationProvider'

function context(requestTimeoutMs = 1000, targetLanguage = 'Simplified Chinese'): ProviderTranslationContext {
  return {
    settings: {
      provider: 'google',
      apiBaseUrl: '',
      model: '',
      temperature: 0,
      maxChunkChars: 6000,
      maxSegmentsPerChunk: 40,
      maxResponseTokens: 4000,
      targetLanguage,
      requestTimeoutMs,
      useJsonResponseFormat: false,
      disableThinking: true
    }
  }
}

function mockFetch(handler: typeof globalThis.fetch): () => void {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return () => {
    globalThis.fetch = original
  }
}

describe('googleProvider', () => {
  it('maps batch translations back to segment ids by index', async () => {
    const restore = mockFetch(async () => new Response(JSON.stringify([['你好', '世界'], ['en', 'en']]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))

    try {
      const result = await googleProvider.translateSegments(
        [{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }],
        context()
      )

      assert.equal(result.get('s1'), '你好')
      assert.equal(result.get('s2'), '世界')
    } finally {
      restore()
    }
  })

  it('escapes prose before sending and decodes HTML entities from the response', async () => {
    let sentBody: string | undefined
    const restore = mockFetch(async (_input, init) => {
      sentBody = String(init?.body)
      return new Response(JSON.stringify([['汤姆 &amp; 杰瑞', 'a &lt; b &gt; c', 'it&#39;s'], ['en', 'en', 'en']]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    try {
      const result = await googleProvider.translateSegments(
        [{ id: 's1', text: 'Tom & Jerry' }, { id: 's2', text: 'a < b > c' }, { id: 's3', text: "it's" }],
        context()
      )

      assert.equal(result.get('s1'), '汤姆 & 杰瑞')
      assert.equal(result.get('s2'), 'a < b > c')
      assert.equal(result.get('s3'), "it's")
      assert.ok(sentBody?.includes('Tom &amp; Jerry'), 'prose should be HTML-escaped before sending')
      assert.ok(!sentBody?.includes('Tom & Jerry'), 'raw unescaped prose should not reach the HTML endpoint')
    } finally {
      restore()
    }
  })

  it('throws when the translation count does not match the segment count', async () => {
    const restore = mockFetch(async () => new Response(JSON.stringify([['你好'], ['en']]), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))

    try {
      await assert.rejects(
        () => googleProvider.translateSegments([{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }], context()),
        /Provider returned 1 translations for 2 segments/
      )
    } finally {
      restore()
    }
  })

  it('reports the HTTP status when the endpoint rejects the request', async () => {
    const restore = mockFetch(async () => new Response('rate limited', { status: 429 }))

    try {
      await assert.rejects(
        () => googleProvider.translateSegments([{ id: 's1', text: 'Hello' }], context()),
        /Google translation request failed \(429\)/
      )
    } finally {
      restore()
    }
  })

  it('throws on an unexpected response shape', async () => {
    const restore = mockFetch(async () => new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))

    try {
      await assert.rejects(
        () => googleProvider.translateSegments([{ id: 's1', text: 'Hello' }], context()),
        /Unexpected response format from Google translation API/
      )
    } finally {
      restore()
    }
  })

  it('times out when the endpoint does not respond', async () => {
    const restore = mockFetch((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))

    try {
      await assert.rejects(
        () => googleProvider.translateSegments([{ id: 's1', text: 'Hello' }], context(20)),
        /Google translation request timed out/
      )
    } finally {
      restore()
    }
  })
})
