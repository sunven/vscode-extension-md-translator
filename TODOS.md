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
