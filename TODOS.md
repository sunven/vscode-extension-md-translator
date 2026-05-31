# TODOs

## Add Save As support for translated Markdown

What: Allow users to save translated Markdown as a separate `.md` file after reviewing the diff.

Why: v1 uses virtual diff documents and only supports `Replace Source` or `Discard` so translated content does not hit disk before approval. Some users will want to keep the original English file and save a Chinese copy.

Pros: Enables bilingual document workflows and avoids forcing source replacement.

Cons: Adds filename suggestions, overwrite confirmation, target-path permissions, and stale-translation state handling.

Context: Implement after the virtual diff and explicit writeback flow is stable. The starting point is the approved plan choice to defer `Save As...` from v1.

Depends on / blocked by: Protected Segment Translator, virtual diff provider, and translated-content lifecycle state.

## Add batch Markdown translation

What: Translate multiple Markdown files from a selected folder or multi-select Explorer context.

Why: v1 intentionally supports one `.md` file at a time to avoid rate-limit, partial-failure, cost-control, and recovery complexity.

Pros: Useful for documentation sites, README collections, and repository-wide knowledge base migration.

Cons: Requires queueing, failure recovery, cost warnings, skip rules, progress UI, and stronger writeback confirmation.

Context: Implement as a separate feature after the single-file path proves stable. The current plan chooses sequential chunk translation and fail-fast behavior, which is correct for one file but insufficient for folder-scale workflows.

Depends on / blocked by: Single-file translation, chunk progress, provider error handling, and safe writeback.

## Protect inline emphasis markers for Google/Microsoft translation

What: Extend `pushInlineTokens` in `src/markdownSegments.ts:259` so `**bold**`, `*italic*`, and `~~strike~~` (consider `==mark==`) are split into raw tokens — the same protection already applied to code spans, links, images, and URLs — so emphasis markers never enter the translated text.

Why: The segmenter currently strips code/links/URLs but not emphasis, so `**bold**` stays inside segment text. Google and Microsoft are pure machine translation and may move or drop these markers, and `validateTranslatedMarkdown` only checks front matter, code blocks, links, and table column counts — it will not catch damaged emphasis. AI usually preserves it; machine translation is less reliable.

Pros: Removes the only documented quality risk for the Google/Microsoft providers; makes all three providers safer; consistent with the existing raw-token approach.

Cons: Emphasis parsing is fiddly (nesting, `*` vs `_`, intraword underscores like `a_b_c`, italic-vs-list ambiguity); adds parser complexity; v1 does not need it for the AI path.

Context: See `reports/2026-05-30-add-translation-providers-design.md` premise 6 and the "工程评审 / NOT in scope" section. Both /office-hours and /plan-eng-review deliberately deferred this out of the multi-provider v1. Add a "emphasis markers survive round-trip" test alongside the change.

Depends on / blocked by: None. Can land independently after the multi-provider v1 ships.
