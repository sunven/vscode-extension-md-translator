"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const config_1 = require("./config");
const translateMarkdown_1 = require("./translateMarkdown");
function activate(context) {
    console.log("Markdown AI Translator extension is now active!");
    const translatedMarkdownProvider = new translateMarkdown_1.TranslatedMarkdownContentProvider();
    const translateMarkdownCommand = vscode.commands.registerCommand("mdTranslator.translateMarkdownToChinese", async (uri) => runWithErrorBoundary("Failed to translate Markdown", () => (0, translateMarkdown_1.translateMarkdownToChinese)(context, translatedMarkdownProvider, uri)));
    const setApiKeyCommand = vscode.commands.registerCommand("mdTranslator.setApiKey", async () => (0, config_1.promptAndStoreApiKey)(context));
    const clearApiKeyCommand = vscode.commands.registerCommand("mdTranslator.clearApiKey", async () => (0, config_1.clearApiKey)(context));
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(translateMarkdown_1.TranslatedMarkdownContentProvider.scheme, translatedMarkdownProvider), translateMarkdownCommand, setApiKeyCommand, clearApiKeyCommand);
}
exports.activate = activate;
async function runWithErrorBoundary(label, action) {
    try {
        await action();
    }
    catch (error) {
        await vscode.window.showErrorMessage(`${label}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}
function deactivate() {
    console.log("Markdown AI Translator extension is now deactivated!");
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map