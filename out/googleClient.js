"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleTranslateBatch = exports.googleProvider = void 0;
const language_1 = require("./language");
const translationShared_1 = require("./translationShared");
// Free, unofficial endpoint used by the Google Translate web widget (and by
// read-frog / kiss-translator). The API key below is the public widget key,
// not a user secret. This endpoint can rate-limit or change without notice.
const GOOGLE_TRANSLATE_HTML_URL = 'https://translate-pa.googleapis.com/v1/translateHtml';
const GOOGLE_TRANSLATE_HTML_API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';
const GOOGLE_TRANSLATE_HTML_CLIENT = 'wt_lib';
class GoogleProvider {
    id = 'google';
    requiresApiKey = false;
    async translateSegments(segments, context) {
        if (segments.length === 0) {
            return new Map();
        }
        const targetCode = (0, language_1.targetCodeFor)(context.settings.targetLanguage);
        const translatedTexts = await googleTranslateBatch(segments.map(segment => segment.text), 'auto', targetCode, context.settings.requestTimeoutMs);
        // zipByIndex enforces the length guard: a mismatch throws rather than
        // silently misaligning segment ids, and never fans out to per-segment calls.
        return (0, translationShared_1.zipByIndex)(segments, translatedTexts);
    }
}
exports.googleProvider = new GoogleProvider();
async function googleTranslateBatch(texts, fromLang, toLang, requestTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
        const response = await fetch(GOOGLE_TRANSLATE_HTML_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json+protobuf',
                'X-Goog-API-Key': GOOGLE_TRANSLATE_HTML_API_KEY
            },
            body: JSON.stringify([[texts.map(escapeHtmlEntities), fromLang, toLang], GOOGLE_TRANSLATE_HTML_CLIENT]),
            signal: controller.signal
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new translationShared_1.TranslationClientError(buildGoogleErrorMessage(response.status, responseText), response.status);
        }
        return parseGoogleResponse(responseText);
    }
    catch (error) {
        if (error instanceof translationShared_1.TranslationClientError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new translationShared_1.TranslationClientError('Google translation request timed out.');
        }
        throw new translationShared_1.TranslationClientError(error instanceof Error
            ? `Network error during Google translation: ${error.message}`
            : 'Unknown Google translation error.');
    }
    finally {
        clearTimeout(timeout);
    }
}
exports.googleTranslateBatch = googleTranslateBatch;
function parseGoogleResponse(responseText) {
    let parsed;
    try {
        parsed = JSON.parse(responseText);
    }
    catch (error) {
        throw new translationShared_1.TranslationClientError(`Google translation returned invalid JSON: ${error instanceof Error ? error.message : 'Unknown parse error'}`);
    }
    const translations = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!Array.isArray(translations) || !translations.every(item => typeof item === 'string')) {
        throw new translationShared_1.TranslationClientError('Unexpected response format from Google translation API.');
    }
    return translations.map(decodeHtmlEntities);
}
function buildGoogleErrorMessage(status, responseText) {
    const trimmed = responseText.trim().slice(0, 300);
    return trimmed
        ? `Google translation request failed (${status}): ${trimmed}`
        : `Google translation request failed (${status}).`;
}
// translateHtml treats input as HTML and returns HTML. Sending raw prose lets
// `<`/`&` be parsed as markup and comes back entity-encoded (`Tom &amp; Jerry`),
// which would be written verbatim into the .md file. Escape on the way in and
// decode on the way out so the round-trip preserves the original prose.
function escapeHtmlEntities(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const NAMED_HTML_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
};
function decodeHtmlEntities(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
        if (entity[0] === '#') {
            const isHex = entity[1] === 'x' || entity[1] === 'X';
            const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (Number.isNaN(codePoint)) {
                return match;
            }
            try {
                return String.fromCodePoint(codePoint);
            }
            catch {
                return match;
            }
        }
        return NAMED_HTML_ENTITIES[entity] ?? match;
    });
}
//# sourceMappingURL=googleClient.js.map