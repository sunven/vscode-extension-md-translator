import * as vscode from 'vscode'
import { clearApiKey, promptAndStoreApiKey } from './config'
import { TranslatedMarkdownContentProvider, translateMarkdownToChinese } from './translateMarkdown'

export function activate(context: vscode.ExtensionContext) {
  console.log('File Extension Converter extension is now active!')

  const translatedMarkdownProvider = new TranslatedMarkdownContentProvider()

  const translateMarkdownCommand = vscode.commands.registerCommand(
    'fileExtensionConverter.translateMarkdownToChinese',
    async (uri?: vscode.Uri) => runWithErrorBoundary(
      'Failed to translate Markdown',
      () => translateMarkdownToChinese(context, translatedMarkdownProvider, uri)
    )
  )

  const setApiKeyCommand = vscode.commands.registerCommand(
    'fileExtensionConverter.setApiKey',
    async () => promptAndStoreApiKey(context)
  )

  const clearApiKeyCommand = vscode.commands.registerCommand(
    'fileExtensionConverter.clearApiKey',
    async () => clearApiKey(context)
  )

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TranslatedMarkdownContentProvider.scheme,
      translatedMarkdownProvider
    ),
    translateMarkdownCommand,
    setApiKeyCommand,
    clearApiKeyCommand
  )
}

async function runWithErrorBoundary(label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    await vscode.window.showErrorMessage(
      `${label}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

export function deactivate() {
  console.log('File Extension Converter extension is now deactivated!')
}
