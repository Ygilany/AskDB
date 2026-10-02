---
"@askdb/introspect": minor
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
"@askdb/prisma": patch
"@askdb/connectors": patch
---

Add `@askdb/introspect/kit`, the shared toolkit the engine packages are now built on, and remove ~600 lines of copy-pasted code from the engine packages. No behavior change, except one: when a driver is installed but fails to load (for example because one of its own dependencies such as `pg-connection-string` is missing), the error now reads "The optional `pg` peer dependency failed to load: …" with the real error, instead of the "install `pg`" hint, which is kept for a driver that resolves nowhere (including Yarn PnP's "tried to access pg").

- **@askdb/introspect**: new `@askdb/introspect/kit` subpath export (importable and requireable) with `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` (lazy optional-driver loading with the `resolveFrom` project-root fallback) and `isModuleResolutionFailure(cause, packageName, specifier?)` (true only when the missing specifier is the package itself or the entry point the loader imports, so a missing file inside an installed driver reports the real load error), `compileTableFilters` / `ambiguousFilterWarnings`, `makeTableId` / `makeColumnId`, `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`, and the connection-label helpers (`formatConnectionLabel`, `parseConnectionUrl`, `ConnectionLabelParts`).
- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**: internal refactor onto the kit — the private `glob.ts` / `ids.ts` copies, the per-engine driver loaders, and the row-folding helpers are gone. Public exports (`loadPgDriver`, `isPgDriverInstalled`, `loadMysql2Driver`, `postgresConnectorProvider`, …), error messages, and introspection output are unchanged.
- **@askdb/connectors**: the connection-label helpers moved to `@askdb/introspect/kit`; `@askdb/connectors` re-exports them unchanged.
