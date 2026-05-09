import { strict as assert } from 'assert'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import { TranslatedMarkdownContentProvider, translateMarkdownToChinese, MarkdownTranslationDependencies } from '../translateMarkdown'

describe('extension contributions', () => {
  it('contributes the public commands users need', async () => {
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === 'vscode-extension-file-extension-converter')
    assert.ok(extension, 'development extension should be installed in the test host')

    await extension.activate()

    const translateMarkdownCommand = extension.packageJSON.contributes.commands.find((command: { command: string }) => command.command === 'fileExtensionConverter.translateMarkdownToChinese')
    assert.ok(translateMarkdownCommand, 'translate command should be contributed')

    const commands = await vscode.commands.getCommands(true)

    assert.ok(commands.includes('fileExtensionConverter.translateMarkdownToChinese'))
    assert.ok(commands.includes('fileExtensionConverter.setApiKey'))
    assert.ok(commands.includes('fileExtensionConverter.clearApiKey'))
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
})

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
