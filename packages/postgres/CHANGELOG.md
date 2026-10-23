# @askdb/postgres

## 0.2.0-beta.20

### Minor Changes

- 440054a: Move the connector provider registry into `@askdb/introspect` with open provider ids. Engine adapters now own connection resolution, and the CLI and Studio per-engine switches are gone (ADR 0008).
  
  - **@askdb/introspect**:
    - New root exports: `createConnectorRegistry`, `ConnectorProviderAdapter`, `ConnectorProviderAdapters`, `ConnectorConfig`, `ConnectorResult`, `ConnectorRegistry`, `ConnectorConnection`, `ConnectorConnectionRequest`, `ConnectorConnectionResult`, `ConnectorConnectionResolution`, `ConnectorRuntimeConfig`, `ConnectorProviderId`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS`, `BuiltInConnectorProvider`.
    - Provider ids are typed `ConnectorProviderId = BuiltInConnectorProvider | (string & {})`, so a third-party engine can register its own id.
    - Adapters can implement `resolveConnection({ explicit?, runtime, surface? })`, which merges explicit values (CLI flags) with AskDB runtime config into `{ url?, fromExport?, schemaPath? }` (or an error). The registry adds `sourceLabel`, built from the adapter's `connectionLabelParts` with `formatConnectionLabel`, so no adapter supplies label text.
    - The registry exposes `resolveConnection(provider, request)`, `connectionLabel(provider, connection)` and `providers()`. `resolveConnection` treats a blank explicit value (empty or whitespace-only) as absent, so the configured connection applies. An adapter without `connectionLabelParts` is labeled `configured <provider> connection`.
    - `createConnectorRegistry()` throws when two adapters use the same provider id, instead of silently keeping the last one.
    - `@askdb/introspect/kit` adds `defineLiveConnectorProvider` for live-catalog-only engines (with `LiveConnectorProviderSpec`, `LiveCatalogInput`, and an optional `fromExportUnsupported` message, defaulting to `--from-export is not supported for --engine <id>.`), and `runtimeIntrospectionString(runtime, key)` for reading `runtime.introspection`.
  - **@askdb/connectors**: deprecated. It is now a re-export shim of the `@askdb/introspect` registry and the `@askdb/introspect/kit` connection-label helpers. `CONNECTOR_PROVIDERS` aliases `BUILT_IN_CONNECTOR_PROVIDERS`. `ConnectorProvider` aliases `ConnectorProviderId` and is now an open string type instead of a closed union. Migrate imports to `@askdb/introspect`.
  - **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**:
    - Each provider adapter now implements `resolveConnection`. The logic and error messages are ported from the CLI and Studio. The label keeps coming from each adapter's `connectionLabelParts`; with no schema path, the Prisma label is now `configured prisma connection` (it was the fixed text `auto-discovered prisma/schema.prisma`).
    - The adapters now take their types from `@askdb/introspect`, and the `@askdb/connectors` dependency is dropped. Their exported adapter's `provider` type widens from the closed five-id union to `ConnectorProviderId`, a type-level change, hence minor.
    - MySQL, SQLite, and SQL Server adapters are built with `defineLiveConnectorProvider`.
  - **askdb**:
    - `askdb introspect` resolves `--engine` and connections through the registry, with no per-engine switch.
    - Flag and config precedence and error messages are unchanged. The one exception: `askdb introspect templates --engine prisma` now prints the generic "does not provide SQL templates" error.
    - Drops the `@askdb/connectors` dependency.
  - **@askdb/studio**:
    - The server-side introspection plan and run, and the source label, dispatch through the registry, with no per-engine switch.
    - Messages are unchanged. The one visible change: a Prisma connection with no schema path is labelled `configured prisma connection` (it was `auto-discovered prisma/schema.prisma`).
    - Drops the `@askdb/connectors` dependency.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.

### Patch Changes

- 1825d01: Fix a SQL Server password leak in Studio's introspection source label, and build connection labels from parsed parts at the connector registry instead of masking.
  
  Studio's `redactUrl` relied on `new URL()`; for `sqlserver://host;database=db;user=sa;password=S3cret` (the Prisma/JDBC-style format) the non-special scheme parses with an opaque host that still contains the whole `;password=…` tail, so the password was shown in the UI.
  
  A label is now built only from the host, port and database (or a file path) that the engine's own parser extracts cleanly; no other part of the connection string is ever copied into it. Adapters return those parts, never label text, and the registry always builds the label with `formatConnectionLabel`. Anything that doesn't parse cleanly, and any provider without a parser, gets `configured <engine> connection`. User names, passwords and query strings never appear. See `docs/adrs/0011-connection-labels-from-parsed-parts.md`.
  
  - **@askdb/connectors**: `ConnectorProviderAdapter` gains an optional `connectionLabelParts(connection)` hook, and `ConnectorRegistry` gains `connectionLabel(provider, connection)`, which builds the label from those parts. New exports: `formatConnectionLabel(engine, parts)` (the allowlist every label passes through), `parseConnectionUrl(input, schemes)` (a strict standard-URL parser for third-party engines whose driver has no parser to reuse), and the `ConnectionLabelParts` and `ConnectorConnection` types. `formatConnectionLabel` also falls back when the parts aren't a plain object or a part isn't a string, and the registry falls back when a `connectionLabelParts` hook throws, so its message never becomes the label.
  - **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlserver**, **@askdb/sqlite**, **@askdb/prisma**: each connector provider adapter implements `connectionLabelParts`, taking host, port and database from the driver's own parser, so the label names what the connection will use. Postgres uses `pg-connection-string` (the parser `pg` uses; now a dependency of `@askdb/postgres`, in the range `pg` declares), including a `?host=` override (`postgres://app:S3cret@db:5432/app` → `postgres://db:5432/app`); a libpq `key=value` string, a JDBC URL, or a quoted or malformed URL falls back. MySQL reads `mysql://` URLs the way `mysql2`'s `parseUrl` does (WHATWG `URL`). SQL Server uses `resolveConnectionInput()` for `mssql://` URLs and Prisma's `sqlserver://host:port;database=…` form (now also reading Prisma's `{…}` escape for a value that holds a `;`; a `sqlserver://` string with `{`, a quote or an ambiguous `;` gets the fallback label), and `@tediousjs/connection-string` (the parser `mssql` uses; now a dependency of `@askdb/sqlserver`, in a range `mssql`'s accepts) for ADO.NET `Server=…;Database=…;` strings (→ `sqlserver://host:port/database`); a string the driver rejects, a named instance or pipe, or an `@` in the `sqlserver://` form falls back, and an ADO.NET value the driver reads as part of the password (after `;;`, a leading `;`, or Unicode whitespace) never becomes the database or server. An `@` or `#` after the host of a URL falls back for every engine. SQLite shows a plain path, or only the path of a `file:` URI (its query string, where encryption keys go, is never read). Postgres export bundles and Prisma schema paths are shown as paths, through the same allowlist.
  - **@askdb/studio**: `GET /api/introspect/status` serves `registry.connectionLabel()` as `sourceLabel` (for example `postgres://db:5432/app` or `configured sqlserver connection`); Studio no longer switches on the engine to build it.
- 1ca3eba: Add `@askdb/introspect/kit`, the shared toolkit the engine packages are now built on, and remove ~600 lines of copy-pasted code from the engine packages. No behavior change, except one: when a driver is installed but fails to load (for example because one of its own dependencies such as `pg-connection-string` is missing), the error now reads "The optional `pg` peer dependency failed to load: …" with the real error, instead of the "install `pg`" hint, which is kept for a driver that resolves nowhere (including Yarn PnP's "tried to access pg").
  
  - **@askdb/introspect**: new `@askdb/introspect/kit` subpath export (importable and requireable) with `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` (lazy optional-driver loading with the `resolveFrom` project-root fallback) and `rethrowDriverImportError` (chained on each engine's driver `import()` so bundlers such as esbuild keep treating the driver as an optional peer) (the loader treats only a missing driver package or entry point as "not installed", so a missing file inside an installed driver reports the real load error), `compileTableFilters` / `ambiguousFilterWarnings`, `makeTableId` / `makeColumnId`, `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`, and the connection-label helpers (`formatConnectionLabel`, `parseConnectionUrl`, `ConnectionLabelParts`).
  - **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**: internal refactor onto the kit — the private `glob.ts` / `ids.ts` copies, the per-engine driver loaders, and the row-folding helpers are gone. Public exports (`loadPgDriver`, `isPgDriverInstalled`, `loadMysql2Driver`, `postgresConnectorProvider`, …), error messages, and introspection output are unchanged.
  - **@askdb/connectors**: the connection-label helpers moved to `@askdb/introspect/kit`; `@askdb/connectors` re-exports them unchanged.
- c55bfb3: Stop rendering foreign keys to or from declarative-partition leaves (ADR 0003).
  
  PG11+ clones a foreign key declared on a partitioned table onto every partition, and PG12+ also clones a foreign key that *references* a partitioned table once per referenced partition. The `foreign_keys` catalog template returned those clones, so a table referencing a partitioned table could render relationships to partition leaves that the `tables` template already removes. The template now drops any constraint whose referencing or referenced relation is a partition of a partitioned parent — the same `pg_inherits` predicate `tables` uses. This is equivalent to `conparentid = 0` for cloned constraints but keeps the templates PG10-compatible (`conparentid` is PG11+).
  
  Air-gapped users should re-export the `foreign_keys` template (`askdb introspect templates --engine postgres`). The schema lock hash changes once for databases where FKs reference partitioned tables.
- Updated dependencies [e7ea657]
- Updated dependencies [c610168]
- Updated dependencies [440054a]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [c55bfb3]
- Updated dependencies [1ca3eba]
- Updated dependencies [c55bfb3]
- Updated dependencies [9021e54]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
  - @askdb/core@1.0.0-beta.44
  - @askdb/introspect@0.3.0-beta.18

## 0.2.0-beta.19

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [2787b21]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/connectors@0.1.0-beta.8
  - @askdb/introspect@0.3.0-beta.17

## 0.2.0-beta.18

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/connectors@0.1.0-beta.7
  - @askdb/introspect@0.3.0-beta.16

## 0.2.0-beta.17

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/core@1.0.0-beta.41
  - @askdb/introspect@0.3.0-beta.15
  - @askdb/connectors@0.1.0-beta.6

## 0.2.0-beta.16

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/introspect@0.3.0-beta.14
  - @askdb/connectors@0.1.0-beta.5

## 0.2.0-beta.15

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36
  - @askdb/introspect@0.3.0-beta.13
  - @askdb/connectors@0.1.0-beta.4

## 0.2.0-beta.14

### Minor Changes

- 5affd84: **@askdb/{postgres,mysql,sqlite,sqlserver}**: Driver loaders (`createXxxCatalogQueryRunner`) now accept a `resolveFrom?: string` option for embedders that need to resolve the optional native peer from a directory other than `process.cwd()` (e.g. `@askdb/studio` running from an npx cache while the user project sits elsewhere). New `loadXxxDriver` and `isXxxDriverInstalled` helpers are exported for the same reason. `@askdb/sqlserver` additionally re-exports `resolveConnectionInput` and the `MssqlConfigInput` type so embedders can apply the same connection-string normalization the catalog runner uses. Behavior with no option / no helper import is unchanged.

  **@askdb/studio**: SQL Server query execution now routes the connection string through `@askdb/sqlserver`'s `resolveConnectionInput` before constructing the `mssql.ConnectionPool`. Fixes `Failed to connect to localhost:1433 - self-signed certificate` failures on ADO.NET connection strings that use the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default), and adds support for `mssql://` and Prisma-style `sqlserver://` URLs — matching the introspect path. Internal: the execute registry now delegates driver loading and per-engine connection-string normalization to the `@askdb/<engine>` packages instead of re-implementing them, eliminating the drift surface that caused the TLS regression in the first place.

## 0.2.0-beta.13

### Patch Changes

- dc380bc: Remove direct `pg` runtime dependencies from bundled app surfaces and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.

## 0.2.0-beta.12

### Patch Changes

- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26
  - @askdb/introspect@0.3.0-beta.12
  - @askdb/connectors@0.1.0-beta.3

## 0.2.0-beta.11

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/introspect@0.3.0-beta.11
  - @askdb/connectors@0.1.0-beta.2

## 0.2.0-beta.10

### Minor Changes

- efe4a1b: **Ship `@askdb/connectors` — connector provider registry for app/bootstrap wiring.**

  Introduces `@askdb/connectors`, a new workspace package that mirrors the `@askdb/ai` registry pattern for introspection connectors. It provides a provider adapter abstraction and registry factory that concrete database packages register into, replacing per-app switch statements over engine names.

  **`@askdb/connectors`** exports:
  - `createAskDbConnectorRegistry(adapters)` — factory that accepts an array or object-map of provider adapters and returns a registry with `hasProvider()` and `createConnector(config)`.
  - `AskDbConnectorConfig` — unified config shape (`provider`, `url`, `fromExport`, `schemaPath`, `filters`, `schemaId`).
  - `AskDbConnectorResult` — `{ connector, input, mode }` pair consumed by `introspect()`.
  - `AskDbConnectorProviderAdapter` — interface each concrete package implements.
  - `ASKDB_CONNECTOR_PROVIDERS` and `AskDbConnectorProvider` type.
  - `askDbConnectorProviderMissingMessage()` helper for actionable error messages.

  **New provider adapter exports** from each concrete package:
  - `@askdb/postgres` → `postgresConnectorProvider` (live + from-export modes)
  - `@askdb/mysql` → `mysqlConnectorProvider`
  - `@askdb/sqlite` → `sqliteConnectorProvider`
  - `@askdb/sqlserver` → `sqlServerConnectorProvider`
  - `@askdb/prisma` → `prismaConnectorProvider`

  **CLI update:** `apps/cli` now wires all five connector providers through `createAskDbConnectorRegistry` instead of the inline switch in `buildRunConfig`. The CLI's URL resolution and validation logic is unchanged; only the connector/input construction path uses the registry.

### Patch Changes

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/connectors@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20
  - @askdb/introspect@0.3.0-beta.10

## 0.2.0-beta.9

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/introspect@0.3.0-beta.9

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [49efa32]
  - @askdb/introspect@0.3.0-beta.8

## 0.2.0-beta.7

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16
  - @askdb/introspect@0.3.0-beta.7

## 0.2.0-beta.6

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14
  - @askdb/introspect@0.3.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/core@0.5.0-beta.12
  - @askdb/introspect@0.3.0-beta.5

## 0.2.0-beta.4

### Minor Changes

- cd364e3: Remove the `["public"]` default schema filter in the Postgres connector so that introspection now covers all non-system schemas by default. Previously, databases with tables in custom schemas (e.g. `audit`, `reporting`, `db_changelog`) were silently omitted unless the caller explicitly passed `filters.schemas`. Explicit `schemas` and `excludeSchemas` filters continue to work as before.

### Patch Changes

- Updated dependencies [cd364e3]
  - @askdb/introspect@0.3.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10
  - @askdb/introspect@0.3.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

### Patch Changes

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4
  - @askdb/introspect@0.3.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/introspect@0.3.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- a90543b: Reshape AskDB around one package per integration surface (Phase 7.5).

  **Pre-1.0 breaking — `@askdb/core`**
  - `ask()` now requires a `dialect: AskDialect` adapter. Pass `postgresDialect` from `@askdb/postgres` to keep the previous behavior.
  - The `connectionString`, `execute`, and `executor` options are removed from `ask()`. AskDB now returns generated SQL only.
  - The `@askdb/core/postgres` subpath is removed. Postgres-specific dialect, validation, generation, and introspection helpers move to `@askdb/postgres`.
  - The dialect-specific helpers `validatePostgresSelectSql`, `generatePostgresSelectSql`, `buildPostgresSelectGuardrailExplanation`, `buildNlToSqlUserPrompt`, `nlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` move to `@askdb/postgres`.
  - `AnyNormalizedSchema` is now exported from `@askdb/core` (it previously came in via the prompt module).
  - `pg` is no longer a peer dependency of `@askdb/core`.

  **Pre-1.0 breaking — `@askdb/introspect`**
  - The public `IntrospectionInput` discriminated union is removed. Each integration package owns its own input shape (e.g. `PostgresIntrospectionInput` from `@askdb/postgres`).
  - The `Connector` interface is now `Connector<TInput>`, generic over the integration's input. `templates()` is optional. The `engine: "postgres"` literal is gone.
  - `SqlTemplateName` and the Postgres-specific template name union are removed from the public surface. `SqlTemplate.name` is now `string`; `SqlTemplateBundle.engine` is now `string`.
  - `introspect()` no longer has a default connector. Callers must supply one via `options.connector` (e.g. `createPostgresConnector()`).
  - The `askdb-introspect` standalone binary and the `@askdb/introspect/cli` and `@askdb/introspect/postgres` subpaths are removed. Use `askdb introspect` from `@askdb/cli`, and import the connector from `@askdb/postgres`.

  **New — `@askdb/postgres`**
  - New package bundling the Postgres dialect (`postgresDialect`, `generatePostgresSelectSql`, `validatePostgresSelectSql`), the connector (`createPostgresConnector`, live + from-export), the catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`), the bundle reader, and the `pg`-backed catalog runner (`createPostgresCatalogQueryRunner`).
  - `pg` is an optional peer dependency, lazy-loaded only when live catalog introspection is invoked.

  **Pre-1.0 breaking — apps**
  - `@askdb/cli` now wires `postgresDialect` internally. The `askdb introspect` subcommand replaces the retired `askdb-introspect` binary.
  - `@askdb/http-api` no longer accepts execution controls or `connectionString` in request bodies. It returns generated SQL only.
  - `apps/{cli,http-api,tui,docs-site}` moved from `packages/*` to `apps/*`. Repository `directory` metadata updated accordingly.

- 4e462eb: Remove generated-SQL execution from AskDB package surfaces.
  - `@askdb/core` no longer exports `AskDbExecutor` / `TabularResult`, no longer accepts `execute` or `executor`, and `ask()` now returns generated SQL only.
  - `@askdb/introspect` now owns the introspection-only `CatalogQueryRunner` / `CatalogQueryResult` contract for connector catalog reads.
  - `@askdb/postgres` replaces `createPostgresExecutor` / `executeReadOnlySelect` with `createPostgresCatalogQueryRunner` for live introspection.
  - `@askdb/cli` and `@askdb/http-api` no longer execute generated SQL; old execution controls are rejected.

### Patch Changes

- ec3ae3d: Keep the Postgres AI SDK dependency resolved against the same Zod major used by AskDB core, avoiding duplicate AI SDK type instances in workspaces that also install Zod 4.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [28d1b68]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [d9d69bb]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
  - @askdb/introspect@0.3.0-beta.0
