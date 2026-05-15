---
"@askdb/core": minor
"askdb": minor
"@askdb/tui": minor
---

Add the Phase 7 `@askdb/tui` enrichment package and CLI shims.

`@askdb/tui` provides the `askdb-tui` binary for editing Schema v2 table descriptions,
aliases, column metadata, common query language, example questions, and concepts.
It includes AI suggestion helpers with human confirm-before-save and a `bundle`
command that emits loader-compatible single-file Schema v2 JSON artifacts.

`@askdb/core` now exports enrichment-suggestion prompt helpers for BYO
`LanguageModel` integrations. The `askdb` CLI adds `askdb enrich` and `askdb bundle`
shims that delegate to `askdb-tui` when installed.
