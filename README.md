# JS to JSX Converter

一个简单的 VSCode 插件，用于通过右键菜单将 JavaScript 文件转换为 JSX 文件。

## 功能特性

- 在文件资源管理器中右键点击 `.js` 文件，选择 "Convert to JSX"
- 在编辑器中右键点击 `.js` 文件，选择 "Convert to JSX"  
- 自动重命名文件从 `.js` 到 `.jsx`
- 如果目标文件已存在，会提示用户确认是否替换
- 如果原文件在编辑器中打开，会自动关闭原文件并打开新文件

## 使用方法

1. 在 VSCode 的文件资源管理器中，右键点击任意 `.js` 文件
2. 从上下文菜单中选择 "Convert to JSX"
3. 文件将被重命名为相同名称但扩展名为 `.jsx` 的文件

或者：

1. 在编辑器中打开一个 `.js` 文件
2. 右键点击编辑器内容
3. 从上下文菜单中选择 "Convert to JSX"

## 安装步骤

### 开发模式安装

1. 克隆或下载此项目
2. 在项目根目录运行：

   ```bash
   npm install
   npm run compile
   ```

3. 在 VSCode 中按 `F5` 运行扩展开发模式
4. 在新打开的扩展开发窗口中测试功能

### 打包安装

1. 安装 vsce：

   ```bash
   npm install -g vsce
   ```

2. 在项目根目录运行：

   ```bash
   vsce package
   ```

3. 安装生成的 `.vsix` 文件：

   ```bash
   code --install-extension js-to-jsx-converter-1.0.0.vsix
   ```

## 项目结构

```
├── package.json          # 插件配置和依赖
├── tsconfig.json         # TypeScript 配置
├── src/
│   └── extension.ts      # 主要逻辑
└── out/                  # 编译输出目录
```

## 开发

- `npm run compile`: 编译 TypeScript
- `npm run watch`: 监听文件变化并自动编译
- `F5`: 在 VSCode 中启动扩展开发模式

## 注意事项

- 此插件只对 `.js` 文件有效
- 如果目标 `.jsx` 文件已存在，会询问是否覆盖
- 重命名操作使用 VSCode 的文件系统 API，支持撤销操作

## 许可证

MIT License
