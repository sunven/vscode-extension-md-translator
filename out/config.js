"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectTranslationProvider = exports.clearApiKey = exports.promptAndStoreApiKey = exports.getApiKey = exports.readTranslationSettings = void 0;
const vscode = require("vscode");
const API_KEY_SECRET = 'mdTranslator.openAiCompatibleApiKey';
const PROVIDER_IDS = ['ai', 'google', 'microsoft'];
function readTranslationSettings() {
    const config = vscode.workspace.getConfiguration('mdTranslator');
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
async function selectTranslationProvider() {
    const items = [
        { label: 'AI (OpenAI-compatible)', description: 'Requires an API key', value: 'ai' },
        { label: 'Google Translate', description: 'Free, no API key', value: 'google' },
        { label: 'Microsoft Translator', description: 'Free, no API key', value: 'microsoft' }
    ];
    const current = readTranslationSettings().provider;
    const picked = await vscode.window.showQuickPick(items.map(item => ({ ...item, picked: item.value === current })), { title: 'Select translation method', placeHolder: 'Choose how Markdown is translated' });
    if (!picked) {
        return;
    }
    await vscode.workspace
        .getConfiguration('mdTranslator')
        .update('provider', picked.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Translation method set to ${picked.label}.`);
}
exports.selectTranslationProvider = selectTranslationProvider;
function normalizeBaseUrl(value) {
    return value.trim().replace(/\/+$/, '');
}
function normalizeProvider(value) {
    const normalized = value.trim();
    return PROVIDER_IDS.includes(normalized) ? normalized : 'ai';
}
function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}
//# sourceMappingURL=config.js.map