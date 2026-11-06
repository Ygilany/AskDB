---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The NL→SQL prompt's tenant-policy block names only the tables the prompt shows (#771, ADR 0038). It listed every root, scoped, polymorphic and global table in the policy, and every column holding a root's IDs, including tables marked `tracked: false` and, under retrieval, tables retrieval left out, so their names reached the model provider. The block now leaves those out. A root whose table isn't shown keeps its label and placeholder, which the shown tables' predicates need. A join path through an untracked table is dropped; one through a tracked table retrieval left out stays, with the root column it reaches. Each column's table is looked up in the schema, so a table name holding `#` (SQL Server) resolves correctly.

New arguments, all optional, which `ask()` always passes:

- `buildTenantPromptBlock(policy, scope, prompt)`: `prompt` is `{ schema, tableIds? }`, the prompt's schema and, under retrieval, the ids of the tables the retrieved DDL shows. The block works out the tracked and shown tables from them.
- `buildNlToSqlUserPrompt(…, promptTableIds)`: the ids of the tables `prebuiltDdl` shows. It passes the schema and these ids to the tenant block.
- `AskDialectGenerateOptions.promptTableIds` and `generateSelectSql()`'s `promptTableIds` dep: set with `prebuiltDdl` under retrieval.
- `synthesizeRetrievedDdl()` returns `tableIds`, the ids of the tables its `ddl` shows.

The docs update the privacy model, the core and RAG API references, the multi-tenancy guide and the upgrade guide.
