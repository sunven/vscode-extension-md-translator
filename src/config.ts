import * as vscode from 'vscode'

const API_KEY_SECRET = 'mdTranslator.openAiCompatibleApiKey'

export interface TranslationSettings {
  apiBaseUrl: string
  model: string
  temperature: number
  maxChunkChars: number
  maxResponseTokens: number
  targetLanguage: string
  requestTimeoutMs: number
  useJsonResponseFormat: boolean
}

export function readTranslationSettings(): TranslationSettings {
  const config = vscode.workspace.getConfiguration('mdTranslator')

  return {
    apiBaseUrl: normalizeBaseUrl(config.get('apiBaseUrl', 'https://api.openai.com/v1')),
    model: config.get('model', 'gpt-4o-mini').trim(),
    temperature: clampNumber(config.get('temperature', 0.2), 0, 2),
    maxChunkChars: clampNumber(config.get('maxChunkChars', 6000), 1000, 20000),
    maxResponseTokens: clampNumber(config.get('maxResponseTokens', 4000), 256, 64000),
    targetLanguage: config.get('targetLanguage', 'Simplified Chinese').trim(),
    requestTimeoutMs: clampNumber(config.get('requestTimeoutMs', 60000), 5000, 300000),
    useJsonResponseFormat: config.get('useJsonResponseFormat', false)
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

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}
