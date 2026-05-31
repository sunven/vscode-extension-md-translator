# Changelog

## 0.1.0

- Add multiple translation methods: AI (OpenAI-compatible), Google Translate, and Microsoft Translator.
- Add the `mdTranslator.provider` setting (`ai` / `google` / `microsoft`, default `ai`) and the `Select Translation Method` command to switch.
- Google and Microsoft use free, unofficial endpoints and require no API key; the API-key prompt is skipped for them.
- Introduce a `TranslationProvider` abstraction; AI-specific retry/recovery now lives in the AI provider.
- Derive the ISO language code for Google/Microsoft from the existing `mdTranslator.targetLanguage` name (single source of truth).

## 0.0.7 and earlier

- Markdown-to-Chinese translation via OpenAI-compatible providers, with a side-by-side preview and replace/discard actions.
