"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeAssistantContent = exports.parseTranslationResponse = exports.applyDisableThinkingHint = exports.translateSegmentsWithOpenAI = exports.TranslationClientError = void 0;
class TranslationClientError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'TranslationClientError';
    }
}
exports.TranslationClientError = TranslationClientError;
async function translateSegmentsWithOpenAI(options, segments) {
    if (segments.length === 0) {
        return new Map();
    }
    const requestBody = {
        model: options.model,
        temperature: options.temperature,
        max_tokens: options.maxResponseTokens,
        stream: false,
        messages: [
            {
                role: 'system',
                content: buildTranslationSystemPrompt(options)
            },
            {
                role: 'user',
                content: JSON.stringify({
                    targetLanguage: options.targetLanguage,
                    segments
                })
            }
        ]
    };
    if (options.useJsonResponseFormat) {
        requestBody.response_format = { type: 'json_object' };
    }
    if (options.disableThinking) {
        applyDisableThinkingHint(requestBody, options);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
    try {
        const response = await fetch(`${options.apiBaseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new TranslationClientError(buildProviderErrorMessage(response.status, responseText), response.status);
        }
        const content = decodeAssistantContent(responseText, response.headers.get('content-type'));
        return parseTranslationResponse(content, segments.map(segment => segment.id));
    }
    catch (error) {
        if (error instanceof TranslationClientError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TranslationClientError('Translation request timed out.');
        }
        throw new TranslationClientError(error instanceof Error ? error.message : 'Unknown provider error.');
    }
    finally {
        clearTimeout(timeout);
    }
}
exports.translateSegmentsWithOpenAI = translateSegmentsWithOpenAI;
function applyDisableThinkingHint(requestBody, options) {
    const provider = detectThinkingControlProvider(options);
    if (provider === 'deepseek') {
        requestBody.thinking = { type: 'disabled' };
        return;
    }
    if (provider === 'qwen') {
        requestBody.enable_thinking = false;
        return;
    }
    if (provider === 'openai-reasoning') {
        requestBody.reasoning_effort = 'none';
    }
}
exports.applyDisableThinkingHint = applyDisableThinkingHint;
function buildTranslationSystemPrompt(options) {
    const rules = [
        'You translate Markdown prose segments.',
        'Return only JSON with this exact shape: {"translations":[{"id":"s1","text":"..."}]}.',
        'Each input segment id must appear exactly once in the translations array.',
        'Never repeat a segment id and never omit one.',
        'Preserve placeholders and markup-like text exactly if present.',
        'Do not add commentary, markdown code fences, or extra keys.'
    ];
    if (options.forceTranslate) {
        rules.push(`The previous attempt returned unchanged source text. Translate every natural-language word into ${options.targetLanguage}.`, 'Do not copy an entire source segment as the translation.', 'Only keep brand names, file paths, URLs, code tokens, placeholders, and other non-prose literals unchanged.');
    }
    return rules.join(' ');
}
function parseTranslationResponse(content, expectedIds) {
    const jsonText = extractJsonObjectText(content);
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (error) {
        throw new TranslationClientError(`Provider returned invalid JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`);
    }
    if (!isTranslationResponse(parsed)) {
        throw new TranslationClientError('Provider response must contain a translations array.');
    }
    const expected = new Set(expectedIds);
    const translations = new Map();
    for (const item of parsed.translations) {
        if (!expected.has(item.id)) {
            throw new TranslationClientError(`Provider returned unknown segment id: ${item.id}`);
        }
        if (translations.has(item.id)) {
            const existing = translations.get(item.id);
            const normalized = normalizeTranslatedText(item.text);
            if (existing === normalized) {
                continue;
            }
            throw new TranslationClientError(`Provider returned conflicting translation for segment id: ${item.id}`);
        }
        translations.set(item.id, normalizeTranslatedText(item.text));
    }
    for (const id of expected) {
        if (!translations.has(id)) {
            throw new TranslationClientError(`Provider response is missing segment id: ${id}`);
        }
    }
    return translations;
}
exports.parseTranslationResponse = parseTranslationResponse;
function decodeAssistantContent(responseText, contentType) {
    if (looksLikeEventStream(contentType, responseText)) {
        return extractAssistantContentFromEventStream(responseText);
    }
    let parsed;
    try {
        parsed = JSON.parse(responseText);
    }
    catch (error) {
        throw new TranslationClientError(`Provider returned invalid completion JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`);
    }
    const content = getPath(parsed, ['choices', 0, 'message', 'content']);
    if (typeof content !== 'string' || !content.trim()) {
        throw new TranslationClientError('Provider response did not include assistant message content.');
    }
    return content;
}
exports.decodeAssistantContent = decodeAssistantContent;
function extractAssistantContentFromEventStream(responseText) {
    const pieces = [];
    for (const line of responseText.split(/\r?\n/)) {
        if (!line.startsWith('data:')) {
            continue;
        }
        const payload = line.slice(5).trim();
        if (!payload) {
            continue;
        }
        if (payload === '[DONE]') {
            break;
        }
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch (error) {
            throw new TranslationClientError(`Provider returned invalid streaming JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`);
        }
        const deltaContent = getPath(parsed, ['choices', 0, 'delta', 'content']);
        if (typeof deltaContent === 'string' && deltaContent.length > 0) {
            pieces.push(deltaContent);
            continue;
        }
        const messageContent = getPath(parsed, ['choices', 0, 'message', 'content']);
        if (typeof messageContent === 'string' && messageContent.length > 0) {
            pieces.push(messageContent);
        }
    }
    if (pieces.length === 0) {
        throw new TranslationClientError('Provider returned a streaming response without assistant content.');
    }
    return pieces.join('');
}
function extractJsonObjectText(content) {
    const trimmed = content.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fencedMatch) {
        return fencedMatch[1].trim();
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new TranslationClientError('Provider response did not contain a JSON object.');
    }
    return trimmed.slice(firstBrace, lastBrace + 1);
}
function buildProviderErrorMessage(status, responseText) {
    const message = extractProviderMessage(responseText);
    return message ? `Provider request failed (${status}): ${message}` : `Provider request failed (${status}).`;
}
function looksLikeEventStream(contentType, responseText) {
    if (contentType?.includes('text/event-stream')) {
        return true;
    }
    return /^\s*data:\s/m.test(responseText);
}
function detectThinkingControlProvider(options) {
    const baseUrl = options.apiBaseUrl.toLowerCase();
    const model = options.model.toLowerCase();
    if (baseUrl.includes('deepseek') || model.includes('deepseek')) {
        return 'deepseek';
    }
    if (baseUrl.includes('dashscope') ||
        baseUrl.includes('aliyuncs') ||
        baseUrl.includes('alibabacloud') ||
        model.includes('qwen')) {
        return 'qwen';
    }
    if (baseUrl.includes('api.openai.com') &&
        /^gpt-5\.[1-9]/.test(model)) {
        return 'openai-reasoning';
    }
    return undefined;
}
function extractProviderMessage(responseText) {
    try {
        const parsed = JSON.parse(responseText);
        const message = getPath(parsed, ['error', 'message']);
        return typeof message === 'string' ? message : undefined;
    }
    catch {
        return responseText.trim().slice(0, 300) || undefined;
    }
}
function normalizeTranslatedText(text) {
    return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}
function isTranslationResponse(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.translations)) {
        return false;
    }
    return value.translations.every(item => (!!item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.text === 'string'));
}
function getPath(value, path) {
    let current = value;
    for (const key of path) {
        if (typeof key === 'number') {
            if (!Array.isArray(current)) {
                return undefined;
            }
            current = current[key];
            continue;
        }
        if (!current || typeof current !== 'object') {
            return undefined;
        }
        current = current[key];
    }
    return current;
}
//# sourceMappingURL=openaiClient.js.map