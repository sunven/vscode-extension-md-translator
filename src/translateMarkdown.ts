import * as path from 'path'
import * as vscode from 'vscode'
import { getApiKey, promptAndStoreApiKey, readTranslationSettings, TranslationSettings } from './config'
import { createTranslationBatches, parseMarkdownSegments, applyTranslations, splitLongMarkdownSegments, validateTranslatedMarkdown } from './markdownSegments'
import { ProviderTranslationContext, resolveProvider, TranslationProvider, TranslationRecoveryReporter } from './translationProvider'
import { TranslationClientError, TranslationSegmentInput } from './translationShared'

type TranslationRunSettings = TranslationSettings & { forceTranslate?: boolean }

export const replaceLastTranslationCommand = 'mdTranslator.replaceLastTranslation'
export const discardLastTranslationCommand = 'mdTranslator.discardLastTranslation'

interface PendingMarkdownTranslation {
  sourceUri: vscode.Uri
  originalText: string
  translatedText: string
  previewPanel: vscode.WebviewPanel
}

type PendingTranslationDependencies = Pick<
  MarkdownTranslationDependencies,
  'readFile' | 'writeFile' | 'showInformationMessage' | 'showErrorMessage'
>

let pendingMarkdownTranslation: PendingMarkdownTranslation | undefined

export class TranslatedMarkdownContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'md-translator-translated'

  private readonly content = new Map<string, string>()
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>()

  readonly onDidChange = this.changeEmitter.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? ''
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.content.set(uri.toString(), content)
    this.changeEmitter.fire(uri)
  }
}

export interface MarkdownTranslationDependencies {
  readTranslationSettings: typeof readTranslationSettings
  getApiKey(context: vscode.ExtensionContext): Promise<string | undefined>
  promptAndStoreApiKey(context: vscode.ExtensionContext): Promise<void>
  readFile(uri: vscode.Uri): Thenable<Uint8Array>
  writeFile(uri: vscode.Uri, data: Uint8Array): Thenable<void>
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>
  showErrorMessage(message: string): Thenable<string | undefined>
  createStatusBarItem(alignment: vscode.StatusBarAlignment, priority?: number): vscode.StatusBarItem
  createWebviewPanel(
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean },
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  ): vscode.WebviewPanel
  withProgress<R>(
    options: vscode.ProgressOptions,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<R>
  ): Thenable<R>
  executeCommand(command: string, ...rest: unknown[]): Thenable<unknown>
  parseMarkdownSegments: typeof parseMarkdownSegments
  splitLongMarkdownSegments?: typeof splitLongMarkdownSegments
  createTranslationBatches: typeof createTranslationBatches
  resolveProvider: typeof resolveProvider
  applyTranslations: typeof applyTranslations
  validateTranslatedMarkdown: typeof validateTranslatedMarkdown
  now?: () => number
}

const defaultMarkdownTranslationDependencies: MarkdownTranslationDependencies = {
  readTranslationSettings,
  getApiKey,
  promptAndStoreApiKey,
  readFile: uri => vscode.workspace.fs.readFile(uri),
  writeFile: (uri, data) => vscode.workspace.fs.writeFile(uri, data),
  showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
  showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
  showErrorMessage: message => vscode.window.showErrorMessage(message),
  createStatusBarItem: (alignment, priority) => vscode.window.createStatusBarItem(alignment, priority),
  createWebviewPanel: (viewType, title, showOptions, options) => vscode.window.createWebviewPanel(viewType, title, showOptions, options),
  withProgress: (options, task) => vscode.window.withProgress(options, task),
  executeCommand: (command, ...rest) => vscode.commands.executeCommand(command, ...rest),
  parseMarkdownSegments,
  splitLongMarkdownSegments,
  createTranslationBatches,
  resolveProvider,
  applyTranslations,
  validateTranslatedMarkdown,
  now: () => Date.now()
}

export async function translateMarkdownToChinese(
  context: vscode.ExtensionContext,
  _contentProvider: TranslatedMarkdownContentProvider,
  uri?: vscode.Uri,
  dependencies: MarkdownTranslationDependencies = defaultMarkdownTranslationDependencies
): Promise<void> {
  const sourceUri = uri ?? vscode.window.activeTextEditor?.document.uri

  if (!sourceUri) {
    await dependencies.showWarningMessage('Open a Markdown file or run this command from a Markdown file context.')
    return
  }

  if (path.extname(sourceUri.fsPath) !== '.md') {
    await dependencies.showWarningMessage('This command only works with .md files')
    return
  }

  const settings = dependencies.readTranslationSettings()
  const provider = dependencies.resolveProvider(settings.provider)
  let apiKey: string | undefined

  if (provider.requiresApiKey) {
    apiKey = await dependencies.getApiKey(context)

    if (!apiKey) {
      const choice = await dependencies.showWarningMessage(
        'OpenAI-compatible API key is not set.',
        'Set API Key',
        'Cancel'
      )

      if (choice === 'Set API Key') {
        await dependencies.promptAndStoreApiKey(context)
      }

      return
    }
  }

  const originalBytes = await dependencies.readFile(sourceUri)
  const originalText = Buffer.from(originalBytes).toString('utf8')
  const parsed = (dependencies.splitLongMarkdownSegments ?? splitLongMarkdownSegments)(
    dependencies.parseMarkdownSegments(originalText),
    settings.maxChunkChars
  )

  if (parsed.segments.length === 0) {
    await dependencies.showInformationMessage('No English prose segments found to translate.')
    return
  }

  const batches = dependencies.createTranslationBatches(parsed.segments, settings.maxChunkChars, settings.maxSegmentsPerChunk)
  const translations = new Map<string, string>()
  let translatedText = ''
  const loading = dependencies.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  discardPendingMarkdownTranslation()
  loading.text = '$(sync~spin) Translating Markdown to Chinese'
  loading.tooltip = 'Markdown translation is running'
  loading.show()

  try {
    await dependencies.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Translating Markdown to Chinese',
      cancellable: true
    }, async (progress, cancellationToken) => {
      await translateBatchesIntoMap({
        apiKey,
        batches,
        cancellationToken,
        loading,
        now: dependencies.now ?? Date.now,
        progress,
        provider,
        settings,
        translations
      })

      progress.report({ message: 'Applying translations' })
      translatedText = dependencies.applyTranslations(parsed, translations)

      if (provider.id === 'ai' && translatedText === originalText) {
        if (cancellationToken.isCancellationRequested) {
          throw new Error('Translation cancelled.')
        }

        translations.clear()
        const retryLabel = 'Retrying unchanged translation'
        loading.text = `$(sync~spin) ${retryLabel}`
        loading.tooltip = retryLabel
        progress.report({ message: retryLabel })

        await translateBatchesIntoMap({
          apiKey,
          attemptLabel: 'Retry',
          batches,
          cancellationToken,
          loading,
          now: dependencies.now ?? Date.now,
          progress,
          provider,
          settings: {
            ...settings,
            forceTranslate: true
          },
          translations
        })

        progress.report({ message: 'Applying translations' })
        translatedText = dependencies.applyTranslations(parsed, translations)
      }
    })
  } finally {
    loading.dispose()
  }

  const validation = dependencies.validateTranslatedMarkdown(originalText, translatedText)

  if (!validation.valid) {
    await dependencies.showErrorMessage(buildValidationFailureMessage(validation.errors))
    return
  }

  setPendingMarkdownTranslation({
    sourceUri,
    originalText,
    translatedText,
    previewPanel: createTranslationPreviewPanel(dependencies, sourceUri, originalText, translatedText)
  })
}

export async function replaceLastPendingMarkdownTranslation(
  dependencies: PendingTranslationDependencies = defaultMarkdownTranslationDependencies
): Promise<void> {
  await replacePendingMarkdownTranslation(dependencies)
}

export function discardLastPendingMarkdownTranslation(): void {
  discardPendingMarkdownTranslation()
}

async function translateBatchesIntoMap(args: {
  apiKey?: string
  attemptLabel?: string
  batches: TranslationSegmentInput[][]
  cancellationToken: vscode.CancellationToken
  loading: vscode.StatusBarItem
  now: () => number
  progress: vscode.Progress<{ message?: string; increment?: number }>
  provider: TranslationProvider
  settings: TranslationRunSettings
  translations: Map<string, string>
}): Promise<void> {
  const { apiKey, attemptLabel, batches, cancellationToken, loading, now, progress, provider, settings, translations } = args
  const progressIncrement = 100 / batches.length

  progress.report({ message: `0 of ${batches.length} chunks complete` })

  for (let index = 0; index < batches.length; index += 1) {
    if (cancellationToken.isCancellationRequested) {
      throw new Error('Translation cancelled.')
    }

    const chunkLabel = `${attemptLabel ? `${attemptLabel} ` : ''}Chunk ${index + 1} of ${batches.length}`
    loading.text = `$(sync~spin) ${chunkLabel}`
    loading.tooltip = chunkLabel

    const batch = batches[index]
    let batchTranslations: Map<string, string>
    const startedAt = now()

    const reporter: TranslationRecoveryReporter = {
      onRetry: error => {
        const message = `${chunkLabel}: retrying after ${summarizeTranslationError(error)}`
        loading.text = `$(sync~spin) ${chunkLabel} (retrying)`
        loading.tooltip = message
        progress.report({ message })
      },
      onSingleSegmentFallbackStart: error => {
        const message = `${chunkLabel}: recovering one segment at a time after ${summarizeTranslationError(error)}`
        loading.text = `$(sync~spin) ${chunkLabel} (recovering)`
        loading.tooltip = message
        progress.report({ message })
      },
      onSingleSegmentFallbackProgress: (segmentIndex, segmentCount) => {
        const message = `${chunkLabel}: recovery segment ${segmentIndex + 1} of ${segmentCount}`
        loading.text = `$(sync~spin) ${chunkLabel} recovery ${segmentIndex + 1}/${segmentCount}`
        loading.tooltip = message
        progress.report({ message })
      }
    }

    const translationContext: ProviderTranslationContext = {
      settings,
      apiKey,
      reporter
    }

    try {
      batchTranslations = await provider.translateSegments(batch, translationContext)
    } catch (error) {
      throw buildBatchTranslationError(error, index, batches.length, batch)
    }

    for (const [id, translatedText] of batchTranslations) {
      translations.set(id, translatedText)
    }

    progress.report({
      message: `${index + 1} of ${batches.length} chunks complete (${formatDuration(now() - startedAt)} for ${chunkLabel})`,
      increment: progressIncrement
    })
  }
}

async function replacePendingMarkdownTranslation(dependencies: PendingTranslationDependencies): Promise<void> {
  const pending = pendingMarkdownTranslation

  if (!pending) {
    await dependencies.showInformationMessage('No pending Markdown translation to replace.')
    return
  }

  const currentText = Buffer.from(await dependencies.readFile(pending.sourceUri)).toString('utf8')

  if (currentText !== pending.originalText) {
    await dependencies.showErrorMessage('Source file changed while translation was running. Re-run translation before replacing it.')
    return
  }

  await dependencies.writeFile(pending.sourceUri, Buffer.from(pending.translatedText, 'utf8'))
  discardPendingMarkdownTranslation()
  await dependencies.showInformationMessage('Markdown source replaced with the Chinese translation.')
}

function setPendingMarkdownTranslation(pending: PendingMarkdownTranslation): void {
  discardPendingMarkdownTranslation()
  pendingMarkdownTranslation = pending
  pending.previewPanel.onDidDispose(() => {
    if (pendingMarkdownTranslation?.previewPanel === pending.previewPanel) {
      pendingMarkdownTranslation = undefined
    }
  })
}

function discardPendingMarkdownTranslation(): void {
  const pending = pendingMarkdownTranslation
  pendingMarkdownTranslation = undefined
  pending?.previewPanel.dispose()
}

function createTranslationPreviewPanel(
  dependencies: Pick<MarkdownTranslationDependencies, 'createWebviewPanel' | 'readFile' | 'writeFile' | 'showInformationMessage' | 'showErrorMessage'>,
  sourceUri: vscode.Uri,
  originalText: string,
  translatedText: string
): vscode.WebviewPanel {
  const title = `${path.basename(sourceUri.fsPath)}: 译文`
  const panel = dependencies.createWebviewPanel(
    'mdTranslator.translationPreview',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [],
      retainContextWhenHidden: true
    }
  )

  panel.webview.html = buildTranslationPreviewHtml(title, translatedText)
  panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return
    }

    const { type } = message as { type?: unknown }

    if (type === 'replace') {
      try {
        await replacePendingMarkdownTranslation(dependencies)
      } catch (error) {
        await dependencies.showErrorMessage(`Failed to replace Markdown translation: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      return
    }

    if (type === 'discard') {
      discardPendingMarkdownTranslation()
    }
  })

  return panel
}

function buildTranslationPreviewHtml(
  title: string,
  translatedText: string
): string {
  const nonce = createNonce()
  const translatedLines = splitMarkdownPreviewLines(translatedText)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      height: 100vh;
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-editor-font-size);
    }

    .preview {
      height: 100vh;
      height: 100vh;
      overflow: auto;
      background: var(--vscode-editor-background);
      padding-bottom: 88px;
      box-sizing: border-box;
    }

    .preview-header {
      position: sticky;
      top: 0;
      z-index: 2;
      height: 34px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid var(--vscode-editorGroup-border);
      background: var(--vscode-editorStickyScroll-background, var(--vscode-editor-background));
      color: var(--vscode-sideBarTitle-foreground);
      font-size: 12px;
      font-weight: 600;
    }

    .line {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      min-height: 20px;
      font-family: var(--vscode-editor-font-family);
      line-height: 20px;
    }

    .line-number {
      user-select: none;
      padding: 0 12px 0 8px;
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground);
    }

    .line-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding-right: 18px;
    }

    .line.changed {
      background: color-mix(in srgb, var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, 0.18)) 70%, transparent);
    }

    .actions {
      position: fixed;
      right: 24px;
      bottom: 18px;
      z-index: 5;
      display: flex;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--vscode-widget-border, var(--vscode-editorGroup-border));
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    }

    button {
      min-width: 72px;
      height: 30px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 0 14px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      font: inherit;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    button.primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    button.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

  </style>
</head>
<body>
  <main class="preview" aria-label="Markdown translation preview">
    <div class="preview-header">译文</div>
    ${renderMarkdownPreviewLines(translatedLines)}
  </main>
  <div class="actions">
    <button type="button" data-action="discard">丢弃</button>
    <button type="button" class="primary" data-action="replace">替换</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelector('[data-action="replace"]').addEventListener('click', () => {
      vscode.postMessage({ type: 'replace' });
    });
    document.querySelector('[data-action="discard"]').addEventListener('click', () => {
      vscode.postMessage({ type: 'discard' });
    });
  </script>
</body>
</html>`
}

function splitMarkdownPreviewLines(text: string): string[] {
  return text.split(/\r?\n/)
}

function renderMarkdownPreviewLines(lines: string[]): string {
  return lines.map((line, index) => {
    const visibleLine = line.length > 0 ? escapeHtml(line) : '&nbsp;'

    return `<div class="line changed"><span class="line-number">${index + 1}</span><span class="line-text">${visibleLine}</span></div>`
  }).join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''

  for (let index = 0; index < 32; index += 1) {
    nonce += characters.charAt(Math.floor(Math.random() * characters.length))
  }

  return nonce
}

function buildValidationFailureMessage(errors: string[]): string {
  if (errors.length === 1 && errors[0] === 'Translated Markdown is identical to the source.') {
    return [
      'Translation failed because the provider returned unchanged source text.',
      'Try a stronger translation model, lower temperature, or enable JSON response format if your provider supports it.'
    ].join(' ')
  }

  return `Translation validation failed: ${errors.join(' ')}`
}

function summarizeTranslationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'an unknown provider error'
  }

  return error.message.length > 120 ? `${error.message.slice(0, 117)}...` : error.message
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(0, Math.round(milliseconds))}ms`
  }

  return `${(milliseconds / 1000).toFixed(1)}s`
}

function buildBatchTranslationError(
  error: unknown,
  batchIndex: number,
  batchCount: number,
  segments: TranslationSegmentInput[]
): TranslationClientError {
  const message = error instanceof Error ? error.message : 'Unknown provider error.'
  const status = error instanceof TranslationClientError ? error.status : undefined

  return new TranslationClientError(
    `Chunk ${batchIndex + 1} of ${batchCount} failed for ${formatSegmentIds(segments)}: ${message}`,
    status
  )
}

function formatSegmentIds(segments: TranslationSegmentInput[]): string {
  const ids = segments.map(segment => segment.id)

  if (ids.length === 1) {
    return `segment ${ids[0]}`
  }

  if (ids.length <= 4) {
    return `segments ${ids.join(', ')}`
  }

  return `segments ${ids[0]}-${ids[ids.length - 1]} (${ids.length} total)`
}
