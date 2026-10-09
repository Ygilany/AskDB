# ADR 0008 — Engine packages and the shared engine kit

## Status

Accepted (2026-09-25).

## Context

ADR 0002 organized AskDB around one package per integration. Each integration owned its dialect, connector, input shape, and catalog runner. Since then, two things have changed.

1. **Dialects moved to core** ([ADR 0002](0002-integration-package-layout.md), 2026-10 amendment). The dialect specs now live in `@askdb/core` (`packages/core/src/sql/dialect-spec.ts`): `POSTGRES_DIALECT`, `MYSQL_DIALECT`, `SQLITE_DIALECT`, `SQLSERVER_DIALECT`, and the rest. `ask()` takes a dialect id, and engine packages only re-export their spec. What an engine package owns today is introspection: catalog SQL, row shapes, the optional driver peer, connection-string formats, and connection resolution.
2. **The engine packages had grown by copy-paste.** About 700 lines were duplicated across `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, and `@askdb/prisma`:
   - byte-identical `glob.ts` and `ids.ts`
   - four ~95-line optional-driver loaders that differed only in the package name
   - the row→record mapper, `groupBy`, `byName`, the FK-action mapping, and the unique/FK/index group-and-sort loops
   - the `ambiguous_filter` loop

## Decision

1. **Keep one package per engine.** Driver peers stay optional and engine-local (`pg`, `mysql2`, `better-sqlite3`, `mssql`), and catalog SQL stays engine-specific. The engine packages do not collapse into one package.
2. **Add a shared engine kit at `@askdb/introspect/kit`.** It is a subpath export, importable and requireable, and holds only engine-agnostic mechanics:
   - `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` / `rethrowDriverImportError`
   - `compileTableFilters` / `ambiguousFilterWarnings`
   - `makeTableId` / `makeColumnId`
   - `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`
   - the connection-label helpers (`formatConnectionLabel`, `parseConnectionUrl`; [ADR 0011](0011-connection-labels-from-parsed-parts.md)), which `@askdb/connectors` re-exports for compatibility

   Every first-party engine is built on the kit. Each engine still writes its driver's `import()` literally in its own package, with `.catch(rethrowDriverImportError)` chained on it, so bundlers see the peer where it is declared and treat it as optional.

## Rationale

- **A kit, not a base class.** The kit is a set of plain functions. Engines take what they need, and nothing constrains their catalog SQL or input shapes.
- **One copy to fix.** Driver-error classification (a missing peer versus an installed one that fails to load), glob matching and the label allowlist each live once, so a fix reaches every engine.
- **The kit sits in `@askdb/introspect`,** which every engine already depends on, so it adds no package and no install.

## Consequences

- About 600 lines leave the engine packages. A new engine gets driver loading, filters, ids, row folding and connection labels from the kit.
- `@askdb/introspect` gains a minor release for the new subpath; the engines and `@askdb/connectors` change no public export.
- The kit's driver loader throws `AskDbError`, so importing the kit loads `@askdb/core`, as `@askdb/introspect`'s main entry already does; documented installs of these packages list `ai`, `@askdb/core`'s peer.

## Related

- [ADR 0002 — Integration-package layout](0002-integration-package-layout.md)
- [ADR 0007 — Connector provider registry](0007-connector-registry.md)
- [ADR 0011 — Connection labels from parsed parts](0011-connection-labels-from-parsed-parts.md)
- `packages/introspect/src/kit/`: the engine kit.
- [Connector authoring](../integration/connectors.md)
