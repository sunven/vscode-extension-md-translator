"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipByIndex = exports.normalizeTranslatedText = exports.TranslationClientError = void 0;
class TranslationClientError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'TranslationClientError';
    }
}
exports.TranslationClientError = TranslationClientError;
function normalizeTranslatedText(text) {
    return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}
exports.normalizeTranslatedText = normalizeTranslatedText;
function zipByIndex(segments, translatedTexts) {
    if (translatedTexts.length !== segments.length) {
        throw new TranslationClientError(`Provider returned ${translatedTexts.length} translations for ${segments.length} segments.`);
    }
    const translations = new Map();
    for (let index = 0; index < segments.length; index += 1) {
        translations.set(segments[index].id, normalizeTranslatedText(translatedTexts[index]));
    }
    return translations;
}
exports.zipByIndex = zipByIndex;
//# sourceMappingURL=translationShared.js.map