import { strict as assert } from 'assert'
import { microsoftProvider, resetMicrosoftTokenCache } from '../microsoftClient'
import type { ProviderTranslationContext } from '../translationProvider'

function context(requestTimeoutMs = 1000, targetLanguage = 'Simplified Chinese'): ProviderTranslationContext {
  return {
    settings: {
      provider: 'microsoft',
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

function isAuthUrl(input: RequestInfo | URL): boolean {
  return String(input).includes('/translate/auth')
}

describe('microsoftProvider', () => {
  beforeEach(() => resetMicrosoftTokenCache())

  it('maps batch translations back to segment ids by index', async () => {
    const restore = mockFetch(async input => {
      if (isAuthUrl(input)) {
        return new Response('token-1', { status: 200 })
      }

      return new Response(JSON.stringify([
        { translations: [{ text: '你好' }] },
        { translations: [{ text: '世界' }] }
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    try {
      const result = await microsoftProvider.translateSegments(
        [{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }],
        context()
      )

      assert.equal(result.get('s1'), '你好')
      assert.equal(result.get('s2'), '世界')
    } finally {
      restore()
    }
  })

  it('throws when the translation count does not match the segment count', async () => {
    const restore = mockFetch(async input => {
      if (isAuthUrl(input)) {
        return new Response('token-1', { status: 200 })
      }

      return new Response(JSON.stringify([{ translations: [{ text: '你好' }] }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    try {
      await assert.rejects(
        () => microsoftProvider.translateSegments([{ id: 's1', text: 'Hello' }, { id: 's2', text: 'World' }], context()),
        /Provider returned 1 translations for 2 segments/
      )
    } finally {
      restore()
    }
  })

  it('refreshes the token once and retries after a 401', async () => {
    let authCalls = 0
    let translateCalls = 0

    const restore = mockFetch(async input => {
      if (isAuthUrl(input)) {
        authCalls += 1
        return new Response(`token-${authCalls}`, { status: 200 })
      }

      translateCalls += 1

      if (translateCalls === 1) {
        return new Response('unauthorized', { status: 401 })
      }

      return new Response(JSON.stringify([{ translations: [{ text: '你好' }] }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    try {
      const result = await microsoftProvider.translateSegments([{ id: 's1', text: 'Hello' }], context())

      assert.equal(result.get('s1'), '你好')
      assert.equal(authCalls, 2)
      assert.equal(translateCalls, 2)
    } finally {
      restore()
    }
  })

  it('reports the HTTP status when the endpoint rejects the request', async () => {
    const restore = mockFetch(async input => {
      if (isAuthUrl(input)) {
        return new Response('token-1', { status: 200 })
      }

      return new Response('server error', { status: 500 })
    })

    try {
      await assert.rejects(
        () => microsoftProvider.translateSegments([{ id: 's1', text: 'Hello' }], context()),
        /Microsoft translation request failed \(500\)/
      )
    } finally {
      restore()
    }
  })

  it('times out when the token endpoint does not respond', async () => {
    const restore = mockFetch((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))

    try {
      await assert.rejects(
        () => microsoftProvider.translateSegments([{ id: 's1', text: 'Hello' }], context(20)),
        /Microsoft translation token request timed out/
      )
    } finally {
      restore()
    }
  })
})
