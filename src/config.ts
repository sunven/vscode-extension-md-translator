import * as vscode from 'vscode'

const API_KEY_SECRET = 'mdTranslator.openAiCompatibleApiKey'

export type ProviderId = 'ai' | 'google' | 'microsoft'

const PROVIDER_IDS: readonly ProviderId[] = ['ai', 'google', 'microsoft']

export interface TranslationSettings {
  provider: ProviderId
  apiBaseUrl: string
  model: string
  temperature: number
  maxChunkChars: number
  maxSegmentsPerChunk: number
  maxResponseTokens: number
  targetLanguage: string
  requestTimeoutMs: number
  useJsonResponseFormat: boolean
  disableThinking: boolean
}

export function readTranslationSettings(): TranslationSettings {
  const config = vscode.workspace.getConfiguration('mdTranslator')

  return {
    provider: normalizeProvider(config.get('provider', 'ai')),
    apiBaseUrl: normalizeBaseUrl(config.get('apiBaseUrl', 'https://api.openai.com/v1')),
    model: config.get('model', 'gpt-4o-mini').trim(),
    temperature: clampNumber(config.get('temperature', 0.2), 0, 2),
    maxChunkChars: clampNumber(config.get('maxChunkChars', 20000), 1000, 20000),
    maxSegmentsPerChunk: clampNumber(config.get('maxSegmentsPerChunk', 40), 1, 200),
    maxResponseTokens: clampNumber(config.get('maxResponseTokens', 64000), 256, 64000),
    targetLanguage: config.get('targetLanguage', 'Simplified Chinese').trim(),
    requestTimeoutMs: clampNumber(config.get('requestTimeoutMs', 60000), 5000, 300000),
    useJsonResponseFormat: config.get('useJsonResponseFormat', false),
    disableThinking: config.get('disableThinking', true)
  }
}

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const apiKey = await context.secrets.get(API_KEY_SECRET)
  return apiKey?.trim() || undefined
}

export async function promptAndStoreApiKey(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    title: 'Set OpenAI-compatible API Key',
    prompt: 'Enter the API key for your configured OpenAI-compatible provider.',
    password: true,
    ignoreFocusOut: true,
    validateInput: value => value.trim() ? undefined : 'API key cannot be empty.'
  })

  if (!apiKey) {
    return
  }

  await context.secrets.store(API_KEY_SECRET, apiKey.trim())
  vscode.window.showInformationMessage('OpenAI-compatible API key saved.')
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(API_KEY_SECRET)
  vscode.window.showInformationMessage('OpenAI-compatible API key cleared.')
}

export async function selectTranslationProvider(): Promise<void> {
  const items: Array<vscode.QuickPickItem & { value: ProviderId }> = [
    { label: 'AI (OpenAI-compatible)', description: 'Requires an API key', value: 'ai' },
    { label: 'Google Translate', description: 'Free, no API key', value: 'google' },
    { label: 'Microsoft Translator', description: 'Free, no API key', value: 'microsoft' }
  ]

  const current = readTranslationSettings().provider
  const picked = await vscode.window.showQuickPick(
    items.map(item => ({ ...item, picked: item.value === current })),
    { title: 'Select translation method', placeHolder: 'Choose how Markdown is translated' }
  )

  if (!picked) {
    return
  }

  await vscode.workspace
    .getConfiguration('mdTranslator')
    .update('provider', picked.value, vscode.ConfigurationTarget.Global)

  vscode.window.showInformationMessage(`Translation method set to ${picked.label}.`)
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeProvider(value: string): ProviderId {
  const normalized = value.trim() as ProviderId
  return PROVIDER_IDS.includes(normalized) ? normalized : 'ai'
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}
