"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.targetCodeFor = void 0;
const translationShared_1 = require("./translationShared");
// Single source of truth for the target language is the `targetLanguage`
// setting (a human-readable name used directly in the AI prompt). Google and
// Microsoft need an ISO 639-1 code, which we derive from this table. Keep the
// AI path and the machine-translation path on the same setting to avoid drift.
const LANGUAGE_NAME_TO_CODE = {
    'simplified chinese': 'zh-CN',
    'chinese simplified': 'zh-CN',
    'chinese (simplified)': 'zh-CN',
    'chinese': 'zh-CN',
    'traditional chinese': 'zh-TW',
    'chinese traditional': 'zh-TW',
    'chinese (traditional)': 'zh-TW',
    'english': 'en',
    'japanese': 'ja',
    'korean': 'ko',
    'french': 'fr',
    'german': 'de',
    'spanish': 'es',
    'portuguese': 'pt',
    'italian': 'it',
    'russian': 'ru',
    'arabic': 'ar',
    'hindi': 'hi',
    'vietnamese': 'vi',
    'thai': 'th',
    'indonesian': 'id'
};
const KNOWN_CODES = new Set(Object.values(LANGUAGE_NAME_TO_CODE));
function targetCodeFor(targetLanguage) {
    const normalized = targetLanguage.trim().toLowerCase();
    const mapped = LANGUAGE_NAME_TO_CODE[normalized];
    if (mapped) {
        return mapped;
    }
    // Accept a code that was entered directly (e.g. "zh-CN") so the setting still
    // works for users who prefer codes over names.
    if (KNOWN_CODES.has(targetLanguage.trim())) {
        return targetLanguage.trim();
    }
    throw new translationShared_1.TranslationClientError(`Cannot map target language "${targetLanguage}" to a language code for Google/Microsoft translation. ` +
        'Use a supported language name (for example "Simplified Chinese") or switch the translation method to AI.');
}
exports.targetCodeFor = targetCodeFor;
//# sourceMappingURL=language.js.map