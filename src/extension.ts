import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

export function activate(context: vscode.ExtensionContext) {
  console.log('JS to JSX Converter extension is now active!')

  // 注册命令
  const convertFileCommand = vscode.commands.registerCommand('jsToJsx.convertFile', async (uri: vscode.Uri) => {
    try {
      await convertJsToJsx(uri)
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to convert file: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  })

  context.subscriptions.push(convertFileCommand)
}

async function convertJsToJsx(uri: vscode.Uri): Promise<void> {
  const filePath = uri.fsPath
  const fileExtension = path.extname(filePath)

  // 确保是 .js 文件
  if (fileExtension !== '.js') {
    vscode.window.showWarningMessage('This command only works with .js files')
    return
  }

  const directory = path.dirname(filePath)
  const fileName = path.basename(filePath, '.js')
  const newFilePath = path.join(directory, `${fileName}.jsx`)

  // 检查目标文件是否已存在
  if (fs.existsSync(newFilePath)) {
    const choice = await vscode.window.showWarningMessage(
      `File ${fileName}.jsx already exists. Do you want to replace it?`,
      'Yes',
      'No'
    )

    if (choice !== 'Yes') {
      return
    }
  }

  try {
    // 重命名文件
    await vscode.workspace.fs.rename(uri, vscode.Uri.file(newFilePath))

    // 显示成功消息
    vscode.window.showInformationMessage(`Successfully converted ${fileName}.js to ${fileName}.jsx`)

    // 如果原文件在编辑器中打开，关闭它并打开新文件
    const openEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.fsPath === filePath)

    if (openEditor) {
      // 关闭原编辑器
      await vscode.window.showTextDocument(openEditor.document, { preview: false })
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

      // 打开新文件
      const newDocument = await vscode.workspace.openTextDocument(newFilePath)
      await vscode.window.showTextDocument(newDocument)
    }
  } catch (error) {
    throw new Error(`Failed to rename file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

export function deactivate() {
  console.log('JS to JSX Converter extension is now deactivated!')
}
