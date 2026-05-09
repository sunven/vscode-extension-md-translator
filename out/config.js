"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearApiKey = exports.promptAndStoreApiKey = exports.getApiKey = exports.readTranslationSettings = void 0;
const vscode = require("vscode");
const API_KEY_SECRET = 'fileExtensionConverter.openAiCompatibleApiKey';
function readTranslationSettings() {
    const config = vscode.workspace.getConfiguration('fileExtensionConverter');
    return {
        apiBaseUrl: normalizeBaseUrl(config.get('apiBaseUrl', 'https://api.openai.com/v1')),
        model: config.get('model', 'gpt-4o-mini').trim(),
        temperature: clampNumber(config.get('temperature', 0.2), 0, 2),
        maxChunkChars: clampNumber(config.get('maxChunkChars', 6000), 1000, 20000),
        maxResponseTokens: clampNumber(config.get('maxResponseTokens', 4000), 256, 64000),
        targetLanguage: config.get('targetLanguage', 'Simplified Chinese').trim(),
        requestTimeoutMs: clampNumber(config.get('requestTimeoutMs', 60000), 5000, 300000),
        useJsonResponseFormat: config.get('useJsonResponseFormat', false)
    };
}
exports.readTranslationSettings = readTranslationSettings;
async function getApiKey(context) {
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    return apiKey?.trim() || undefined;
}
exports.getApiKey = getApiKey;
async function promptAndStoreApiKey(context) {
    const apiKey = await vscode.window.showInputBox({
        title: 'Set OpenAI-compatible API Key',
        prompt: 'Enter the API key for your configured OpenAI-compatible provider.',
        password: true,
        ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : 'API key cannot be empty.'
    });
    if (!apiKey) {
        return;
    }
    await context.secrets.store(API_KEY_SECRET, apiKey.trim());
    vscode.window.showInformationMessage('OpenAI-compatible API key saved.');
}
exports.promptAndStoreApiKey = promptAndStoreApiKey;
async function clearApiKey(context) {
    await context.secrets.delete(API_KEY_SECRET);
    vscode.window.showInformationMessage('OpenAI-compatible API key cleared.');
}
exports.clearApiKey = clearApiKey;
function normalizeBaseUrl(value) {
    return value.trim().replace(/\/+$/, '');
}
function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}
//# sourceMappingURL=config.js.map