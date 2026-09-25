---
"@askdb/introspect": minor
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
"@askdb/prisma": patch
"@askdb/connectors": patch
---

Add `@askdb/introspect/kit`, the shared toolkit the engine packages are now built on, and remove ~600 lines of copy-pasted code from the engine packages. No behavior change.

- **@askdb/introspect**: new `@askdb/introspect/kit` subpath export (importable and requireable) with `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` (lazy optional-driver loading with the `resolveFrom` project-root fallback), `compileTableFilters` / `ambiguousFilterWarnings`, `makeTableId` / `makeColumnId`, `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`, and the connection-string redaction helpers (`redactUrlUserinfo`, `redactSecretKeyValues`, `redactConnectionStringGeneric`, `hasUrlScheme`, `isSecretConnectionKey`, `REDACTED_SECRET`).
- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**: internal refactor onto the kit — the private `glob.ts` / `ids.ts` copies, the per-engine driver loaders, and the row-folding helpers are gone. Public exports (`loadPgDriver`, `isPgDriverInstalled`, `loadMysql2Driver`, `redactConnectionString`, …), error messages, and introspection output are unchanged.
- **@askdb/connectors**: the redaction helpers moved to `@askdb/introspect/kit`; `@askdb/connectors` re-exports them unchanged.
