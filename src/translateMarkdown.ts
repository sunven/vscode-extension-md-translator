import * as path from 'path'
import * as vscode from 'vscode'
import { getApiKey, promptAndStoreApiKey, readTranslationSettings } from './config'
import { createTranslationBatches, parseMarkdownSegments, applyTranslations, splitLongMarkdownSegments, validateTranslatedMarkdown } from './markdownSegments'
import { TranslationClientError, TranslationSegmentInput, translateSegmentsWithOpenAI } from './openaiClient'

const replaceSourceAction = 'Replace Source'
const discardAction = 'Discard'
export const replaceLastTranslationCommand = 'mdTranslator.replaceLastTranslation'
export const discardLastTranslationCommand = 'mdTranslator.discardLastTranslation'

interface PendingMarkdownTranslation {
  sourceUri: vscode.Uri
  originalText: string
  translatedText: string
  replaceStatusBarItem: vscode.StatusBarItem
  discardStatusBarItem: vscode.StatusBarItem
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
  withProgress<R>(
    options: vscode.ProgressOptions,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<R>
  ): Thenable<R>
  executeCommand(command: string, ...rest: unknown[]): Thenable<unknown>
  parseMarkdownSegments: typeof parseMarkdownSegments
  splitLongMarkdownSegments?: typeof splitLongMarkdownSegments
  createTranslationBatches: typeof createTranslationBatches
  translateSegmentsWithOpenAI: typeof translateSegmentsWithOpenAI
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
  withProgress: (options, task) => vscode.window.withProgress(options, task),
  executeCommand: (command, ...rest) => vscode.commands.executeCommand(command, ...rest),
  parseMarkdownSegments,
  splitLongMarkdownSegments,
  createTranslationBatches,
  translateSegmentsWithOpenAI,
  applyTranslations,
  validateTranslatedMarkdown,
  now: () => Date.now()
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
        dependencies,
        loading,
        now: dependencies.now ?? Date.now,
        progress,
        settings,
        translations
      })

      progress.report({ message: 'Applying translations' })
      translatedText = dependencies.applyTranslations(parsed, translations)

      if (translatedText === originalText) {
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
          dependencies,
          loading,
          now: dependencies.now ?? Date.now,
          progress,
          settings: {
            ...settings,
            targetLanguage: buildStrictRetryTargetLanguage(settings.targetLanguage)
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

  const translatedUri = createTranslatedMarkdownUri(sourceUri)
  contentProvider.setContent(translatedUri, translatedText)

  await dependencies.executeCommand(
    'vscode.diff',
    sourceUri,
    translatedUri,
    `${path.basename(sourceUri.fsPath)}: Original ↔ Chinese translation`
  )

  setPendingMarkdownTranslation({
    sourceUri,
    originalText,
    translatedText,
    replaceStatusBarItem: createPendingTranslationStatusBarItem(
      dependencies,
      '$(check) Replace Translation',
      'Replace the source Markdown with the pending translation',
      replaceLastTranslationCommand,
      99
    ),
    discardStatusBarItem: createPendingTranslationStatusBarItem(
      dependencies,
      '$(close) Discard Translation',
      'Discard the pending Markdown translation',
      discardLastTranslationCommand,
      98
    )
  })

  const action = await dependencies.showInformationMessage(
    'Review the Markdown diff before replacing the source file.',
    replaceSourceAction,
    discardAction
  )

  if (action === discardAction) {
    discardPendingMarkdownTranslation()
    return
  }

  if (action !== replaceSourceAction) {
    return
  }

  await replacePendingMarkdownTranslation(dependencies)
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
  apiKey: string
  attemptLabel?: string
  batches: TranslationSegmentInput[][]
  cancellationToken: vscode.CancellationToken
  dependencies: Pick<MarkdownTranslationDependencies, 'translateSegmentsWithOpenAI'>
  loading: vscode.StatusBarItem
  now: () => number
  progress: vscode.Progress<{ message?: string; increment?: number }>
  settings: ReturnType<typeof readTranslationSettings>
  translations: Map<string, string>
}): Promise<void> {
  const { apiKey, attemptLabel, batches, cancellationToken, dependencies, loading, now, progress, settings, translations } = args
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

    try {
      batchTranslations = await translateBatchWithRecovery(
        dependencies.translateSegmentsWithOpenAI,
        {
          ...settings,
          apiKey
        },
        batch,
        {
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
      )
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
  pending.replaceStatusBarItem.show()
  pending.discardStatusBarItem.show()
}

function discardPendingMarkdownTranslation(): void {
  pendingMarkdownTranslation?.replaceStatusBarItem.dispose()
  pendingMarkdownTranslation?.discardStatusBarItem.dispose()
  pendingMarkdownTranslation = undefined
}

function createPendingTranslationStatusBarItem(
  dependencies: Pick<MarkdownTranslationDependencies, 'createStatusBarItem'>,
  text: string,
  tooltip: string,
  command: string,
  priority: number
): vscode.StatusBarItem {
  const item = dependencies.createStatusBarItem(vscode.StatusBarAlignment.Left, priority)
  item.text = text
  item.tooltip = tooltip
  item.command = command
  return item
}

function buildStrictRetryTargetLanguage(targetLanguage: string): string {
  return `${targetLanguage}. The previous attempt returned unchanged source text. Translate every English prose segment into ${targetLanguage}; do not copy the English source text unless it is a protected term, brand name, code token, URL, or file path.`
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

async function translateBatchWithRecovery(
  translateSegments: typeof translateSegmentsWithOpenAI,
  options: Parameters<typeof translateSegmentsWithOpenAI>[0],
  segments: TranslationSegmentInput[],
  reporter?: TranslationRecoveryReporter
): Promise<Map<string, string>> {
  try {
    return await translateSegments(options, segments)
  } catch (firstError) {
    reporter?.onRetry(firstError)

    try {
      return await translateSegments(options, segments)
    } catch (retryError) {
      if (!canRecoverBySingleSegmentFallback(retryError, segments)) {
        throw retryError
      }

      reporter?.onSingleSegmentFallbackStart(retryError)
      const recovered = new Map<string, string>()

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        let segmentTranslations: Map<string, string>
        reporter?.onSingleSegmentFallbackProgress(index, segments.length)

        try {
          segmentTranslations = await translateSegments(options, [segment])
        } catch (segmentError) {
          throw buildSingleSegmentFallbackError(segmentError, segment.id)
        }

        for (const [id, translatedText] of segmentTranslations) {
          recovered.set(id, translatedText)
        }
      }

      return recovered
    }
  }
}

interface TranslationRecoveryReporter {
  onRetry(error: unknown): void
  onSingleSegmentFallbackStart(error: unknown): void
  onSingleSegmentFallbackProgress(segmentIndex: number, segmentCount: number): void
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

function canRecoverBySingleSegmentFallback(error: unknown, segments: TranslationSegmentInput[]): boolean {
  if (segments.length <= 1 || !(error instanceof TranslationClientError)) {
    return false
  }

  return [
    'Provider returned conflicting translation for segment id:',
    'Provider response is missing segment id:',
    'Provider returned unknown segment id:',
    'Provider returned invalid JSON:',
    'Provider response must contain a translations array.',
    'Provider response did not contain a JSON object.'
  ].some(message => error.message.includes(message))
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

function buildSingleSegmentFallbackError(error: unknown, segmentId: string): TranslationClientError {
  const message = error instanceof Error ? error.message : 'Unknown provider error.'
  const status = error instanceof TranslationClientError ? error.status : undefined

  return new TranslationClientError(
    `Single-segment retry failed for ${segmentId}: ${message}`,
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

function createTranslatedMarkdownUri(sourceUri: vscode.Uri): vscode.Uri {
  const basename = path.basename(sourceUri.fsPath, '.md')
  return vscode.Uri.from({
    scheme: TranslatedMarkdownContentProvider.scheme,
    path: `${sourceUri.path}.${basename}.zh.md`,
    query: String(Date.now())
  })
}
