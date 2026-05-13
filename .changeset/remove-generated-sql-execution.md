---
"@askdb/core": minor
"@askdb/introspect": minor
"@askdb/postgres": minor
"@askdb/cli": minor
"@askdb/http-api": minor
---

Remove generated-SQL execution from AskDB package surfaces.

- `@askdb/core` no longer exports `AskDbExecutor` / `TabularResult`, no longer accepts `execute` or `executor`, and `ask()` now returns generated SQL only.
- `@askdb/introspect` now owns the introspection-only `CatalogQueryRunner` / `CatalogQueryResult` contract for connector catalog reads.
- `@askdb/postgres` replaces `createPostgresExecutor` / `executeReadOnlySelect` with `createPostgresCatalogQueryRunner` for live introspection.
- `@askdb/cli` and `@askdb/http-api` no longer execute generated SQL; old execution controls are rejected.
