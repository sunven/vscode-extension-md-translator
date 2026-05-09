# Markdown Translator

一个 VS Code 扩展，用 OpenAI-compatible provider 把英文 `.md` Markdown 文件翻译为简体中文，先展示 raw Markdown diff，再由用户确认是否替换源文件。

## 功能特性

- 打开 `.md` 文件后，点击编辑器右上角的地球图标直接翻译。
- 扩展命令和设置页支持中英文界面；中文 VS Code 会显示中文文案。
- Markdown 翻译使用 OpenAI-compatible API，支持自定义 `baseUrl`、`model`、`temperature`、chunk 大小和超时。
- API key 通过 VS Code SecretStorage 保存，不写入 `settings.json`。
- 翻译前会保护 Markdown 结构，包括 Front Matter、代码块、inline code、链接目标、图片路径、HTML 注释和表格结构。
- 翻译完成后使用 VS Code 内置 diff 编辑器展示原文和译文。
- 只有选择 `Replace Source` 后才会覆盖源 `.md` 文件；选择 `Discard` 不会修改源文件。

## Markdown 翻译使用方法

1. 运行命令 `设置 OpenAI 兼容 API Key` / `Set OpenAI-compatible API Key`，输入你的 API key。
2. 在 VS Code settings 中按需配置：

   ```json
   {
     "fileExtensionConverter.apiBaseUrl": "https://api.openai.com/v1",
     "fileExtensionConverter.model": "gpt-4o-mini",
     "fileExtensionConverter.temperature": 0.2,
     "fileExtensionConverter.maxChunkChars": 6000,
     "fileExtensionConverter.maxResponseTokens": 4000,
     "fileExtensionConverter.targetLanguage": "Simplified Chinese",
     "fileExtensionConverter.requestTimeoutMs": 60000,
     "fileExtensionConverter.useJsonResponseFormat": false
   }
   ```

3. 打开英文 `.md` 文件，点击编辑器右上角的地球图标，或运行命令 `将 Markdown 翻译为中文` / `Translate Markdown to Chinese`。
4. 等待翻译完成并检查 diff。
5. 选择 `Replace Source` 覆盖源文件，或选择 `Discard` 放弃。

隐私说明：Markdown 中需要翻译的自然语言文本会发送到你配置的 OpenAI-compatible provider。受保护的代码块、链接目标等结构会尽量不发送或不翻译，但文档内容仍可能包含敏感信息。请按你的 provider 和文档隐私要求使用。

## 安装步骤

### 开发模式安装

1. 克隆或下载此项目。
2. 在项目根目录运行：

   ```bash
   pnpm install
   pnpm run compile
   ```

3. 在 VS Code 中按 `F5` 运行扩展开发模式。
4. 在新打开的扩展开发窗口中测试功能。

### 打包安装

1. 安装依赖并编译：

   ```bash
   pnpm install
   pnpm run compile
   ```

2. 打包 `.vsix`：

   ```bash
   pnpm run package
   ```

3. 安装生成的 `.vsix` 文件：

   ```bash
   code --install-extension vscode-extension-file-extension-converter-1.0.0.vsix
   ```

## 项目结构

```text
├── package.json              # 扩展配置、命令、菜单和设置项
├── package.nls.json          # 默认英文扩展文案
├── package.nls.zh-cn.json    # 简体中文扩展文案
├── tsconfig.json             # TypeScript 配置
├── src/
│   ├── extension.ts          # VS Code 命令注册和入口
│   ├── config.ts             # 设置项和 SecretStorage
│   ├── markdownSegments.ts   # Markdown 分段、重组和校验
│   ├── openaiClient.ts       # OpenAI-compatible API 调用和 JSON 校验
│   ├── translateMarkdown.ts  # Markdown 翻译工作流
│   └── test/                 # VS Code/Mocha 测试
└── out/                      # 编译输出目录
```

## 开发

- `pnpm run compile`: 编译 TypeScript。
- `pnpm test`: 运行 VS Code 扩展测试。
- `pnpm run watch`: 监听文件变化并自动编译。
- `F5`: 在 VS Code 中启动扩展开发模式。

## 注意事项

- Markdown v1 只支持单个 `.md` 文件，不支持批量翻译文件夹。
- v1 不支持 `Save As...`，译文只能在 diff 后替换源文件或丢弃。
- 如果源文件在翻译过程中发生变化，扩展会阻止写回并要求重新运行翻译。

## 许可证

MIT License
