---
"@askdb/core": minor
"@askdb/postgres": minor
"@askdb/config": patch
"@askdb/introspect": patch
"@askdb/prisma": patch
"askdb": patch
---

**Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

**New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

**`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.
