import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import {
  discardLastPendingMarkdownTranslation,
  MarkdownTranslationDependencies,
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
    const webviewPanels = createWebviewPanels()
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
        maxSegmentsPerChunk: 40,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false,
        disableThinking: true
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
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options),
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

  it('reports notification progress by completed chunks', async () => {
    const segments = [
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' },
      { id: 's3', text: 'Third paragraph.' }
    ]
    const progressReports: Array<{ message?: string; increment?: number }> = []
    let now = 0

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from(segments.map(segment => segment.text).join('\n\n')),
      now: () => {
        now += 1000
        return now
      },
      withProgress: async (_options, task) => task({
        report(update) {
          progressReports.push(update)
        }
      }, { isCancellationRequested: false } as vscode.CancellationToken),
      parseMarkdownSegments: () => ({
        tokens: segments.map(segment => ({ kind: 'segment' as const, id: segment.id, original: segment.text })),
        segments
      }),
      createTranslationBatches: () => segments.map(segment => [segment]),
      translateSegmentsWithOpenAI: async (_options, batchSegments) => new Map(batchSegments.map(segment => [segment.id, `译文-${segment.id}`])),
      applyTranslations: (_parsed, translations) => segments.map(segment => translations.get(segment.id)).join('\n')
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    const increment = 100 / 3
    assert.deepEqual(progressReports, [
      { message: '0 of 3 chunks complete' },
      { message: '1 of 3 chunks complete (1.0s for Chunk 1 of 3)', increment },
      { message: '2 of 3 chunks complete (1.0s for Chunk 2 of 3)', increment },
      { message: '3 of 3 chunks complete (1.0s for Chunk 3 of 3)', increment },
      { message: 'Applying translations' }
    ])

    discardLastPendingMarkdownTranslation()
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
    const webviewPanels = createWebviewPanels()

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
        maxSegmentsPerChunk: 40,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false,
        disableThinking: true
      }),
      getApiKey: async () => 'test-key',
      promptAndStoreApiKey: async () => undefined,
      readFile: async () => Buffer.from('original markdown'),
      writeFile: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createStatusBarItem: () => statusBarItem,
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options),
      withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
      executeCommand: async () => undefined,
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
    assert.equal(webviewPanels.panels.length, 1)
  })

  it('reports retry and single-segment recovery progress', async () => {
    const segments = [
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' }
    ]
    const providerFailure = new TranslationClientError('Provider returned invalid JSON: broken')
    const progressMessages: string[] = []
    let failedBatchAttempts = 0
    let now = 0

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('original markdown'),
      now: () => {
        now += 1000
        return now
      },
      withProgress: async (_options, task) => task({
        report(update) {
          if (update.message) {
            progressMessages.push(update.message)
          }
        }
      }, { isCancellationRequested: false } as vscode.CancellationToken),
      parseMarkdownSegments: () => ({
        tokens: segments.map(segment => ({ kind: 'segment' as const, id: segment.id, original: segment.text })),
        segments
      }),
      createTranslationBatches: batchSegments => [batchSegments],
      translateSegmentsWithOpenAI: async (_options, batchSegments) => {
        if (batchSegments.length > 1 && failedBatchAttempts < 2) {
          failedBatchAttempts += 1
          throw providerFailure
        }

        return new Map(batchSegments.map(segment => [segment.id, `译文-${segment.id}`]))
      },
      applyTranslations: (_parsed, translations) => segments.map(segment => translations.get(segment.id)).join('\n')
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.deepEqual(progressMessages, [
      '0 of 1 chunks complete',
      'Chunk 1 of 1: retrying after Provider returned invalid JSON: broken',
      'Chunk 1 of 1: recovering one segment at a time after Provider returned invalid JSON: broken',
      'Chunk 1 of 1: recovery segment 1 of 2',
      'Chunk 1 of 1: recovery segment 2 of 2',
      '1 of 1 chunks complete (1.0s for Chunk 1 of 1)',
      'Applying translations'
    ])

    discardLastPendingMarkdownTranslation()
  })

  it('reports the isolated segment id when fallback translation still fails', async () => {
    const segments = [
      { id: 's1', text: 'First paragraph.' },
      { id: 's2', text: 'Second paragraph.' }
    ]
    const batchFailure = new TranslationClientError('Provider returned conflicting translation for segment id: s2')
    const segmentFailure = new TranslationClientError('Provider response is missing segment id: s2')
    let failedBatchAttempts = 0
    const webviewPanels = createWebviewPanels()

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
        maxSegmentsPerChunk: 40,
        maxResponseTokens: 4000,
        targetLanguage: 'Simplified Chinese',
        requestTimeoutMs: 1000,
        useJsonResponseFormat: false,
        disableThinking: true
      }),
      getApiKey: async () => 'test-key',
      promptAndStoreApiKey: async () => undefined,
      readFile: async () => Buffer.from('original markdown'),
      writeFile: async () => undefined,
      showWarningMessage: async () => undefined,
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createStatusBarItem: () => statusBarItem,
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options),
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

  it('shows a translation-only preview webview with bottom-right replace and discard actions', async () => {
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('# hello <world>\n'),
      applyTranslations: () => '# 你好 <世界>\n',
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options)
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    const panel = webviewPanels.panels[0]
    assert.equal(panel.viewType, 'mdTranslator.translationPreview')
    assert.equal(panel.showOptions, vscode.ViewColumn.Beside)
    assert.equal(panel.options?.enableScripts, true)
    assert.equal(panel.title, 'doc.md: 译文')
    assert.match(panel.webview.html, /<div class="preview-header">译文<\/div>/)
    assert.doesNotMatch(panel.webview.html, /# hello &lt;world&gt;/)
    assert.match(panel.webview.html, /# 你好 &lt;世界&gt;/)
    assert.match(panel.webview.html, /position: fixed/)
    assert.match(panel.webview.html, /right: 24px/)
    assert.match(panel.webview.html, /bottom: 18px/)
    assert.match(panel.webview.html, /data-action="replace">替换/)
    assert.match(panel.webview.html, /data-action="discard">丢弃/)

    discardLastPendingMarkdownTranslation()
  })

  it('clears the previous pending preview when a new translation starts', async () => {
    let sourceText = '# hello\n'
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from(sourceText),
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options)
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    const firstPanel = webviewPanels.panels[0]
    assert.equal(firstPanel.disposed, false)

    sourceText = '# hello again\n'

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.equal(firstPanel.disposed, true)
    assert.equal(webviewPanels.panels.length, 2)

    discardLastPendingMarkdownTranslation()
  })

  it('replaces the source from the pending preview action', async () => {
    let sourceText = '# hello\n'
    let writtenText: string | undefined
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from(sourceText),
      writeFile: async (_uri, data) => {
        writtenText = Buffer.from(data).toString('utf8')
        sourceText = writtenText
      },
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options)
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    const panel = webviewPanels.panels[0]
    await webviewPanels.postMessage(panel, { type: 'replace' })

    assert.equal(writtenText, '你好')
    assert.equal(panel.disposed, true)
  })

  it('discards the pending translation from the preview action', async () => {
    let writeCalls = 0
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      writeFile: async () => {
        writeCalls += 1
      },
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options)
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    const panel = webviewPanels.panels[0]
    await webviewPanels.postMessage(panel, { type: 'discard' })

    assert.equal(writeCalls, 0)
    assert.equal(panel.disposed, true)
  })

  it('retries when the provider returns unchanged Markdown', async () => {
    const targetLanguages: string[] = []
    const forceTranslateValues: Array<boolean | undefined> = []
    let providerCalls = 0
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('hello'),
      translateSegmentsWithOpenAI: async (options, batchSegments) => {
        targetLanguages.push(options.targetLanguage)
        forceTranslateValues.push(options.forceTranslate)
        providerCalls += 1

        if (providerCalls === 1) {
          return new Map(batchSegments.map(segment => [segment.id, segment.text]))
        }

        return new Map(batchSegments.map(segment => [segment.id, '你好']))
      },
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options)
    })

    await translateMarkdownToChinese(
      { secrets: { get: async () => 'test-key' } } as unknown as vscode.ExtensionContext,
      new TranslatedMarkdownContentProvider(),
      vscode.Uri.file('/tmp/doc.md'),
      dependencies
    )

    assert.equal(providerCalls, 2)
    assert.deepEqual(targetLanguages, ['Simplified Chinese', 'Simplified Chinese'])
    assert.deepEqual(forceTranslateValues, [undefined, true])
    assert.equal(webviewPanels.panels.length, 1)

    discardLastPendingMarkdownTranslation()
  })

  it('shows a specific error when unchanged Markdown persists after retry', async () => {
    let errorMessage: string | undefined
    const webviewPanels = createWebviewPanels()

    const dependencies = createSingleSegmentTranslationDependencies({
      readFile: async () => Buffer.from('hello'),
      translateSegmentsWithOpenAI: async (_options, batchSegments) => new Map(batchSegments.map(segment => [segment.id, segment.text])),
      createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options),
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

    assert.equal(webviewPanels.panels.length, 0)
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
  const webviewPanels = createWebviewPanels()

  return {
    readTranslationSettings: () => ({
      apiBaseUrl: 'https://example.test/v1',
      model: 'gpt-test',
      temperature: 0.2,
      maxChunkChars: 6000,
      maxSegmentsPerChunk: 40,
      maxResponseTokens: 4000,
      targetLanguage: 'Simplified Chinese',
      requestTimeoutMs: 1000,
      useJsonResponseFormat: false,
      disableThinking: true
    }),
    getApiKey: async () => 'test-key',
    promptAndStoreApiKey: async () => undefined,
    readFile: async () => Buffer.from('# hello\n'),
    writeFile: async () => undefined,
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createStatusBarItem: () => statusBarItem,
    createWebviewPanel: (viewType, title, showOptions, options) => webviewPanels.create(viewType, title, showOptions, options),
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

type WebviewMessageListener = (message: unknown) => unknown

type TestWebviewPanel = vscode.WebviewPanel & {
  disposed: boolean
  viewType: string
  showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean }
  options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  messageListeners: WebviewMessageListener[]
}

function createWebviewPanels(): {
  panels: TestWebviewPanel[]
  create(
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean },
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  ): vscode.WebviewPanel
  postMessage(panel: TestWebviewPanel, message: unknown): Promise<void>
} {
  const panels: TestWebviewPanel[] = []

  return {
    panels,
    create(viewType, title, showOptions, options) {
      const messageListeners: WebviewMessageListener[] = []
      const disposeListeners: Array<() => void> = []
      const panel = {
        viewType,
        title,
        showOptions,
        options,
        disposed: false,
        active: true,
        visible: true,
        viewColumn: typeof showOptions === 'number' ? showOptions : showOptions.viewColumn,
        webview: {
          html: '',
          options: {},
          cspSource: 'vscode-test:',
          asWebviewUri: (uri: vscode.Uri) => uri,
          postMessage: async () => true,
          onDidReceiveMessage(listener: WebviewMessageListener) {
            messageListeners.push(listener)
            return { dispose() {} }
          }
        },
        onDidDispose(listener: () => void) {
          disposeListeners.push(listener)
          return { dispose() {} }
        },
        onDidChangeViewState() {
          return { dispose() {} }
        },
        reveal() {},
        dispose() {
          if (panel.disposed) {
            return
          }

          panel.disposed = true
          for (const listener of disposeListeners) {
            listener()
          }
        }
      } as unknown as TestWebviewPanel

      panel.messageListeners = messageListeners
      panels.push(panel)
      return panel
    },
    async postMessage(panel, message) {
      for (const listener of panel.messageListeners) {
        await listener(message)
      }
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
