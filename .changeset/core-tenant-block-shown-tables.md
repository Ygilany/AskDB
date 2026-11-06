---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The NL→SQL prompt's tenant-policy block names only the tables the prompt shows (#771, ADR 0038). It listed every root, scoped, polymorphic and global table in the policy, and every column holding a root's IDs, including tables marked `tracked: false` and, under retrieval, tables retrieval left out, so their names reached the model provider. `ask()` now passes the shown tables: the tracked ones, and under retrieval only the retrieved ones. A root whose table isn't shown keeps its label and placeholder, which the model needs for the shown tables' predicates. A join path through an untracked table is dropped; one through a tracked table retrieval left out stays.

`buildTenantPromptBlock()` and `buildNlToSqlUserPrompt()` take the shown tables as a new argument, `AskGenerateOptions` and `generateSelectSql()`'s deps gain `promptTableIds` (the retrieved tables, set with `prebuiltDdl`), and `synthesizeRetrievedDdl()` returns `tableIds`.

The docs update the privacy model and the upgrade guide.
