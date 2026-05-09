import * as path from 'path'
import * as vscode from 'vscode'
import { getApiKey, promptAndStoreApiKey, readTranslationSettings } from './config'
import { createTranslationBatches, parseMarkdownSegments, applyTranslations, validateTranslatedMarkdown } from './markdownSegments'
import { translateSegmentsWithOpenAI } from './openaiClient'

const replaceSourceAction = 'Replace Source'
const discardAction = 'Discard'

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
  withProgress<R>(
    options: vscode.ProgressOptions,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<R>
  ): Thenable<R>
  executeCommand(command: string, ...rest: unknown[]): Thenable<unknown>
  parseMarkdownSegments: typeof parseMarkdownSegments
  createTranslationBatches: typeof createTranslationBatches
  translateSegmentsWithOpenAI: typeof translateSegmentsWithOpenAI
  applyTranslations: typeof applyTranslations
  validateTranslatedMarkdown: typeof validateTranslatedMarkdown
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
  withProgress: (options, task) => vscode.window.withProgress(options, task),
  executeCommand: (command, ...rest) => vscode.commands.executeCommand(command, ...rest),
  parseMarkdownSegments,
  createTranslationBatches,
  translateSegmentsWithOpenAI,
  applyTranslations,
  validateTranslatedMarkdown
}

export async function translateMarkdownToChinese(
  context: vscode.ExtensionContext,
  contentProvider: TranslatedMarkdownContentProvider,
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
  const apiKey = await dependencies.getApiKey(context)

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

  const originalBytes = await dependencies.readFile(sourceUri)
  const originalText = Buffer.from(originalBytes).toString('utf8')
  const parsed = dependencies.parseMarkdownSegments(originalText)

  if (parsed.segments.length === 0) {
    await dependencies.showInformationMessage('No English prose segments found to translate.')
    return
  }

  const batches = dependencies.createTranslationBatches(parsed.segments, settings.maxChunkChars)
  const translations = new Map<string, string>()
  const loading = dependencies.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  loading.text = '$(sync~spin) Translating Markdown to Chinese'
  loading.tooltip = 'Markdown translation is running'
  loading.show()

  try {
    await dependencies.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Translating Markdown to Chinese',
      cancellable: true
    }, async (progress, cancellationToken) => {
      for (let index = 0; index < batches.length; index += 1) {
        if (cancellationToken.isCancellationRequested) {
          throw new Error('Translation cancelled.')
        }

        const chunkLabel = `Chunk ${index + 1} of ${batches.length}`
        loading.text = `$(sync~spin) ${chunkLabel}`
        loading.tooltip = chunkLabel
        progress.report({
          message: chunkLabel,
          increment: index === 0 ? 0 : 100 / batches.length
        })

        const batchTranslations = await dependencies.translateSegmentsWithOpenAI({
          ...settings,
          apiKey
        }, batches[index])

        for (const [id, translatedText] of batchTranslations) {
          translations.set(id, translatedText)
        }
      }

      progress.report({ increment: 100 })
    })
  } finally {
    loading.dispose()
  }

  const translatedText = dependencies.applyTranslations(parsed, translations)
  const validation = dependencies.validateTranslatedMarkdown(originalText, translatedText)

  if (!validation.valid) {
    await dependencies.showErrorMessage(`Translation validation failed: ${validation.errors.join(' ')}`)
    return
  }

  const translatedUri = createTranslatedMarkdownUri(sourceUri)
  contentProvider.setContent(translatedUri, translatedText)

  await dependencies.executeCommand(
    'vscode.diff',
    sourceUri,
    translatedUri,
    `${path.basename(sourceUri.fsPath)}: Original ↔ Chinese translation`
  )

  const action = await dependencies.showInformationMessage(
    'Review the Markdown diff before replacing the source file.',
    replaceSourceAction,
    discardAction
  )

  if (action !== replaceSourceAction) {
    return
  }

  const currentText = Buffer.from(await dependencies.readFile(sourceUri)).toString('utf8')

  if (currentText !== originalText) {
    await dependencies.showErrorMessage('Source file changed while translation was running. Re-run translation before replacing it.')
    return
  }

  await dependencies.writeFile(sourceUri, Buffer.from(translatedText, 'utf8'))
  await dependencies.showInformationMessage('Markdown source replaced with the Chinese translation.')
}

function createTranslatedMarkdownUri(sourceUri: vscode.Uri): vscode.Uri {
  const basename = path.basename(sourceUri.fsPath, '.md')
  return vscode.Uri.from({
    scheme: TranslatedMarkdownContentProvider.scheme,
    path: `${sourceUri.path}.${basename}.zh.md`,
    query: String(Date.now())
  })
}
