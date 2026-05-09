import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import {
  discardLastPendingMarkdownTranslation,
  MarkdownTranslationDependencies,
  replaceLastPendingMarkdownTranslation,
  TranslatedMarkdownContentProvider,
  translateMarkdownToChinese
} from '../translateMarkdown'
import { TranslationClientError } from '../openaiClient'

describe('extension contributions', () => {
  it('contributes the public commands users need', async () => {
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'vscode-extension-md-translator')
    assert.ok(extension, 'development extension should be installed in the test host')

    await extension.activate()

    const translateMarkdownCommand = extension.packageJSON.contributes.commands.find((command: { command: string }) => command.command === 'mdTranslator.translateMarkdownToChinese')
    assert.ok(translateMarkdownCommand, 'translate command should be contributed')

    const commands = await vscode.commands.getCommands(true)

    assert.ok(commands.includes('mdTranslator.translateMarkdownToChinese'))
    assert.ok(commands.includes('mdTranslator.setApiKey'))
    assert.ok(commands.includes('mdTranslator.clearApiKey'))
    assert.equal(translateMarkdownCommand.icon, '$(globe)')
  })

  it('provides English and Chinese strings for package localization keys', () => {
    const root = path.resolve(__dirname, '..', '..')
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const englishMessages = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
    const chineseMessages = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8'))
    const keys = collectLocalizationKeys(packageJson)

    assert.ok(keys.length > 0, 'package.json should use package.nls localization keys')

    for (const key of keys) {
      assert.equal(typeof englishMessages[key], 'string', `Missing English package.nls key: ${key}`)
      assert.equal(typeof chineseMessages[key], 'string', `Missing Chinese package.nls key: ${key}`)
      assert.ok(chineseMessages[key].trim().length > 0, `Chinese package.nls key is empty: ${key}`)
    }
  })

  it('serves translated Markdown through a virtual document provider', async () => {
    const provider = new TranslatedMarkdownContentProvider()
    const uri = vscode.Uri.from({
      scheme: TranslatedMarkdownContentProvider.scheme,
      path: '/README.zh.md'
    })

    provider.setContent(uri, '# 标题\n')

    assert.equal(provider.provideTextDocumentContent(uri), '# 标题\n')
  })

  it('shows a loading status while translating Markdown', async () => {
    const calls: Array<{ type: string; value?: string }> = []
    const statusBarItem = {
      text: '',
      tooltip: '',
      show() {
        calls.push({ type: 'show' })
      },
      dispose() {
        calls.push({ type: 'dispose' })
      }
    } as vscode.StatusBarItem

    const dependencies: MarkdownTranslationDependencies = {
      readTranslationSettings: () => ({
        apiBaseUrl: 'https://example.test/v1',
        model: 'gpt-test',
        temperature: 0.2,
        maxChunkChars: 6000,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false
      }),
      getApiKey: async () => 'test-key',
      promptAndStoreApiKey: async () => undefined,
      readFile: async () => Buffer.from('# hello\n'),
      writeFile: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createStatusBarItem: (_alignment, priority) => priority === 100 ? statusBarItem : {
        text: '',
        tooltip: '',
        command: undefined,
        show() {},
        dispose() {}
      } as vscode.StatusBarItem,
      withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
      executeCommand: async () => undefined,
      parseMarkdownSegments: () => ({
        tokens: [{ kind: 'segment', id: 's1', original: 'hello' }],
        segments: [{ id: 's1', text: 'hello' }]
      }),
      createTranslationBatches: segments => [segments],
      translateSegmentsWithOpenAI: async () => new Map([['s1', '你好']]),
      applyTranslations: (_parsed, translations) => translations.get('s1') ?? '',
      validateTranslatedMarkdown: () => ({ valid: true, errors: [] })
    }

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.equal(statusBarItem.text, '$(sync~spin) Chunk 1 of 1')
    assert.equal(statusBarItem.tooltip, 'Chunk 1 of 1')
    assert.deepEqual(calls, [{ type: 'show' }, { type: 'dispose' }])
  })

  it('recovers from malformed provider responses by retrying and isolating segments', async () => {
    const segments = [
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' },
      { id: 's3', text: 'Third paragraph.' }
    ]
    const translateCallSizes: number[] = []
    const providerFailure = new TranslationClientError('Provider returned conflicting translation for segment id: s2')
    let failedBatchAttempts = 0
    let diffOpened = false

    const statusBarItem = {
      text: '',
      tooltip: '',
      show() {},
      dispose() {}
    } as vscode.StatusBarItem

    const dependencies: MarkdownTranslationDependencies = {
      readTranslationSettings: () => ({
        apiBaseUrl: 'https://example.test/v1',
        model: 'gpt-test',
        temperature: 0.2,
        maxChunkChars: 6000,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false
      }),
      getApiKey: async () => 'test-key',
      promptAndStoreApiKey: async () => undefined,
      readFile: async () => Buffer.from('original markdown'),
      writeFile: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createStatusBarItem: () => statusBarItem,
      withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
      executeCommand: async command => {
        if (command === 'vscode.diff') {
          diffOpened = true
        }
      },
      parseMarkdownSegments: () => ({
        tokens: segments.map(segment => ({ kind: 'segment' as const, id: segment.id, original: segment.text })),
        segments
      }),
      createTranslationBatches: batchSegments => [batchSegments],
      translateSegmentsWithOpenAI: async (_options, batchSegments) => {
        translateCallSizes.push(batchSegments.length)

        if (batchSegments.length > 1 && failedBatchAttempts < 2) {
          failedBatchAttempts += 1
          throw providerFailure
        }

        return new Map(batchSegments.map(segment => [segment.id, `译文-${segment.id}`]))
      },
      applyTranslations: (_parsed, translations) => segments.map(segment => translations.get(segment.id)).join('\n'),
      validateTranslatedMarkdown: () => ({ valid: true, errors: [] })
    }

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.deepEqual(translateCallSizes, [3, 3, 1, 1, 1])
    assert.equal(diffOpened, true)
  })

  it('reports the isolated segment id when fallback translation still fails', async () => {
    const segments = [
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' }
    ]
    const batchFailure = new TranslationClientError('Provider returned conflicting translation for segment id: s2')
    const segmentFailure = new TranslationClientError('Provider response is missing segment id: s2')
    let failedBatchAttempts = 0

    const statusBarItem = {
      text: '',
      tooltip: '',
      show() {},
      dispose() {}
    } as vscode.StatusBarItem

    const dependencies: MarkdownTranslationDependencies = {
      readTranslationSettings: () => ({
        apiBaseUrl: 'https://example.test/v1',
        model: 'gpt-test',
        temperature: 0.2,
        maxChunkChars: 6000,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false
      }),
      getApiKey: async () => 'test-key',
      promptAndStoreApiKey: async () => undefined,
      readFile: async () => Buffer.from('original markdown'),
      writeFile: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createStatusBarItem: () => statusBarItem,
      withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
      executeCommand: async () => undefined,
      parseMarkdownSegments: () => ({
        tokens: segments.map(segment => ({ kind: 'segment' as const, id: segment.id, original: segment.text })),
        segments
      }),
      createTranslationBatches: batchSegments => [batchSegments],
      translateSegmentsWithOpenAI: async (_options, batchSegments) => {
        if (batchSegments.length > 1 && failedBatchAttempts < 2) {
          failedBatchAttempts += 1
          throw batchFailure
        }

        if (batchSegments[0]?.id === 's2') {
          throw segmentFailure
        }

        return new Map(batchSegments.map(segment => [segment.id, `译文-${segment.id}`]))
      },
      applyTranslations: () => '',
      validateTranslatedMarkdown: () => ({ valid: true, errors: [] })
    }

    await assert.rejects(
      () => translateMarkdownToChinese(
        { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
        new TranslatedMarkdownContentProvider(),
        vscode.Uri.file('/tmp/doc.md'),
        dependencies
      ),
      /Chunk 1 of 1 failed for segments s1, s2: Single-segment retry failed for s2: Provider response is missing segment id: s2/
    )
  })

  it('shows status bar actions for a pending translated Markdown diff', async () => {
    const statusBarItems = createStatusBarItems()

    const dependencies = createSingleSegmentTranslationDependencies({
      createStatusBarItem: () => statusBarItems.create()
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.ok(statusBarItems.items.some(item => item.text === '$(check) Replace Translation' && item.command === 'mdTranslator.replaceLastTranslation' && item.shown))
    assert.ok(statusBarItems.items.some(item => item.text === '$(close) Discard Translation' && item.command === 'mdTranslator.discardLastTranslation' && item.shown))

    discardLastPendingMarkdownTranslation()
  })

  it('replaces the source from the pending translation status bar action', async () => {
    let sourceText = '# hello\n'
    let writtenText: string | undefined
    const statusBarItems = createStatusBarItems()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from(sourceText),
      writeFile: async (_uri, data) => {
        writtenText = Buffer.from(data).toString('utf8')
        sourceText = writtenText
      },
      createStatusBarItem: () => statusBarItems.create()
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    await replaceLastPendingMarkdownTranslation(dependencies)

    assert.equal(writtenText, '你好')
    assert.ok(statusBarItems.items.some(item => item.text === '$(check) Replace Translation' && item.disposed))
    assert.ok(statusBarItems.items.some(item => item.text === '$(close) Discard Translation' && item.disposed))
  })

  it('retries when the provider returns unchanged Markdown', async () => {
    const targetLanguages: string[] = []
    let providerCalls = 0
    let diffOpened = false

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('hello'),
      translateSegmentsWithOpenAI: async (options, batchSegments) => {
        targetLanguages.push(options.targetLanguage)
        providerCalls += 1

        if (providerCalls === 1) {
          return new Map(batchSegments.map(segment => [segment.id, segment.text]))
        }

        return new Map(batchSegments.map(segment => [segment.id, '你好']))
      },
      executeCommand: async command => {
        if (command === 'vscode.diff') {
          diffOpened = true
        }
      }
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.equal(providerCalls, 2)
    assert.equal(targetLanguages[0], 'Simplified Chinese')
    assert.match(targetLanguages[1], /previous attempt returned unchanged source text/)
    assert.equal(diffOpened, true)

    discardLastPendingMarkdownTranslation()
  })

  it('shows a specific error when unchanged Markdown persists after retry', async () => {
    let errorMessage: string | undefined
    let diffOpened = false

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('hello'),
      translateSegmentsWithOpenAI: async (_options, batchSegments) => new Map(batchSegments.map(segment => [segment.id, segment.text])),
      executeCommand: async command => {
        if (command === 'vscode.diff') {
          diffOpened = true
        }
      },
      showErrorMessage: async message => {
        errorMessage = message
        return undefined
      },
      validateTranslatedMarkdown: (original, translated) => translated === original
        ? { valid: false, errors: ['Translated Markdown is identical to the source.'] }
        : { valid: true, errors: [] }
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.equal(diffOpened, false)
    assert.equal(
      errorMessage,
      'Translation failed because the provider returned unchanged source text. Try a stronger translation model, lower temperature, or enable JSON response format if your provider supports it.'
    )
  })
})

function createSingleSegmentTranslationDependencies(
  overrides: Partial<MarkdownTranslationDependencies> = {}
): MarkdownTranslationDependencies {
  const statusBarItem = {
    text: '',
    tooltip: '',
    command: undefined,
    show() {},
    dispose() {}
  } as vscode.StatusBarItem

  return {
    readTranslationSettings: () => ({
      apiBaseUrl: 'https://example.test/v1',
      model: 'gpt-test',
      temperature: 0.2,
      maxChunkChars: 6000,
      maxResponseTokens: 4000,
      targetLanguage: 'Simplified Chinese',
      requestTimeoutMs: 1000,
      useJsonResponseFormat: false
    }),
    getApiKey: async () => 'test-key',
    promptAndStoreApiKey: async () => undefined,
    readFile: async () => Buffer.from('# hello\n'),
    writeFile: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createStatusBarItem: () => statusBarItem,
    withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
    executeCommand: async () => undefined,
    parseMarkdownSegments: () => ({
      tokens: [{ kind: 'segment', id: 's1', original: 'hello' }],
      segments: [{ id: 's1', text: 'hello' }]
    }),
    createTranslationBatches: segments => [segments],
    translateSegmentsWithOpenAI: async () => new Map([['s1', '你好']]),
    applyTranslations: (_parsed, translations) => translations.get('s1') ?? '',
    validateTranslatedMarkdown: () => ({ valid: true, errors: [] }),
    ...overrides
  }
}

function createStatusBarItems(): {
  items: Array<vscode.StatusBarItem & { shown: boolean; disposed: boolean }>
  create(): vscode.StatusBarItem
} {
  const items: Array<vscode.StatusBarItem & { shown: boolean; disposed: boolean }> = []

  return {
    items,
    create() {
      const item = {
        text: '',
        tooltip: '',
        command: undefined,
        shown: false,
        disposed: false,
        show() {
          this.shown = true
        },
        dispose() {
          this.disposed = true
        }
      } as vscode.StatusBarItem & { shown: boolean; disposed: boolean }

      items.push(item)
      return item
    }
  }
}

function collectLocalizationKeys(value: unknown): string[] {
  const keys = new Set<string>()
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      const match = item.match(/^%(.+)%$/)
      if (match) {
        keys.add(match[1])
      }
      return
    }

    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }

    if (item && typeof item === 'object') {
      Object.values(item).forEach(visit)
    }
  }

  visit(value)
  return [...keys].sort()
}
