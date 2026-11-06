# @askdb/introspect

## 0.3.0-beta.20

### Minor Changes

- f3decbb: Every AskDB write into a schema directory now refuses symbolic links (#617, ADR 0028).
  
  - New `@askdb/core` export: `saveSchemaFile(schemaDir, relativePath, content)` writes one file inside a schema directory; `content` is a string (written as UTF-8) or a `Uint8Array`. It refuses a symbolic link at the file or at a directory between it and the schema directory (such as `tables/`), and a `relativePath` with an empty, `.` or `..` part or a NUL byte. It writes a temp file next to the target, with the target's permission bits, group and, where allowed, owner, and renames it over the target, so a hard link is replaced instead of written through and the write is atomic. A read-only target is refused with `EACCES`. The schema directory itself may be a symbolic link. This is the helper `@askdb/enrich`'s saves used since #372, moved to core so every writer shares it.
  - `@askdb/introspect`: `renderToSchemaV2()`, and so `introspect()` with render options, writes `schema.json` through `saveSchemaFile()`. A `schema.json` that is a symbolic link now throws `Refusing to write schema.json outside the schema directory: "schema.json" is a symbolic link`. Before, the write went to the file the link pointed at.
  - `askdb`: `askdb introspect --out` fails the same way on a linked `schema.json`.
  - `@askdb/studio`: Playground history (`playground-history.json`, saved on every generate and on delete) and the `.gitignore` entry Studio adds for it are written through `saveSchemaFile()`, and so is `schema.json` on **Resync schema**. A linked history file fails the request with the refusal message. A linked `.gitignore` is left as it is and the history still saves, as with any `.gitignore` failure before. A dangling link at `.gitignore` no longer creates the file it names. The `.gitignore` update keeps the existing file's bytes, so a non-UTF-8 file name in it survives.
  - `@askdb/enrich`: `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` call core's `saveSchemaFile()`; the behavior is unchanged. The refusal for a table now reads `Refusing to write tables/orders.md outside the schema directory: …` instead of `Refusing to write table markdown outside tables/: …`. The check on a table filename keeps its message.
  
  **Upgrade notes:**
  
  - `renderToSchemaV2()`, `introspect()` with render options, and `askdb introspect --out` throw when `schema.json` in the output directory is a symbolic link. Replace the link with a regular file.
  - Writing `schema.json` now needs write access to the output directory for the temp file, and a hard link at `schema.json` is replaced instead of written through. The new file keeps the old one's mode bits, owner and group, but not an access control list (#659). On Windows, the rename fails with `EPERM` while another process holds `schema.json` open; running again usually works.
- 76dc3a3: `createConnectorRegistry()` accepts **lazy entries** next to adapters: `{ provider, load }`, where `load()` imports an engine package the host may not have installed and returns its adapter (`LazyConnectorProviderAdapter`, `ConnectorProviderEntry`). `hasProvider()` and `providers()` list a lazy entry without loading it. The new `registry.load(provider)` imports it once (concurrent calls share the import, and a failed one is retried), rejects an adapter whose `provider` differs from the entry's, and resolves an adapter object as it is. Until an entry is loaded, `createConnector`, `resolveConnection`, `getTemplates` and `connectionLabel` throw for it instead of falling back. `connectorPackageMissingMessage({ provider, packageName, allowBuilds })` gives the `askdb` CLI's and Studio's install hint for a missing engine package, with the pnpm build approvals it needs. A registry of adapters only behaves as before. See ADR 0008's 2026-11-05 amendment.
  
  The kit's `createOptionalDriverLoader` no longer says to install a driver that is on disk but that Node can't resolve. Node 24 and later can keep a failed package lookup until the process exits, so a long-running host can miss a package installed after its first attempt; the loader now says to restart the process instead.

### Patch Changes

- Updated dependencies [47eef72]
- Updated dependencies [d82125c]
- Updated dependencies [b40309d]
- Updated dependencies [f3decbb]
- Updated dependencies [7ca1940]
- Updated dependencies [234eec0]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [cdab7d7]
- Updated dependencies [ed7f35c]
- Updated dependencies [4d6a315]
- Updated dependencies [4d6a315]
  - @askdb/core@1.0.0-beta.46

## 0.3.0-beta.19

### Minor Changes

- aa187f2: Remove the deprecated `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic` and `@askdb/connectors` packages. They are no longer published or fixed. Their last versions stay on npm (`@askdb/ai-openai`, `-azure` and `-google` 1.0.0-beta.8, `@askdb/ai-anthropic` 1.0.0-beta.6, `@askdb/connectors` 0.1.0-beta.9), so existing installs keep working.
  
  **Breaking** for code that still imports one of them. Install and import these instead:
  
  - `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-anthropic`: install `@askdb/ai` and the matching AI SDK package (`@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google` or `@ai-sdk/anthropic`). `createAskDb({ config })` and `createAiRegistry()` register every built-in provider, so drop `providers: [openaiProvider]`, or pass names such as `providers: ["openai"]` to restrict the set. `openaiProvider`, `azureProvider`, `googleProvider` and `anthropicProvider` are exported from `@askdb/ai`.
  - `@askdb/connectors`: import `createConnectorRegistry`, `connectorProviderMissingMessage`, `BUILT_IN_CONNECTOR_PROVIDERS` and the `Connector*` types from `@askdb/introspect`, and `formatConnectionLabel`, `parseConnectionUrl` and `ConnectionLabelParts` from `@askdb/introspect/kit`. `CONNECTOR_PROVIDERS` becomes `BUILT_IN_CONNECTOR_PROVIDERS`, and `ConnectorProvider` becomes `ConnectorProviderId`.
  
  `@askdb/core`'s README no longer lists `@askdb/connectors` among the packages that need `ai` installed.

### Patch Changes

- 3d62eb5: The package READMEs link to ADR 0003, ADR 0011 and the connector authoring guide with absolute GitHub URLs. The old `../../docs/…` links pointed outside the package, so they were dead wherever the README is read from the installed package.
- Updated dependencies [c099a66]
- Updated dependencies [5bd780a]
- Updated dependencies [61f23b0]
- Updated dependencies [798cc4f]
- Updated dependencies [aa187f2]
- Updated dependencies [e8afa01]
  - @askdb/core@1.0.0-beta.45

## 0.3.0-beta.18

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
- 1ca3eba: Add `@askdb/introspect/kit`, the shared toolkit the engine packages are now built on, and remove ~600 lines of copy-pasted code from the engine packages. No behavior change, except one: when a driver is installed but fails to load (for example because one of its own dependencies such as `pg-connection-string` is missing), the error now reads "The optional `pg` peer dependency failed to load: …" with the real error, instead of the "install `pg`" hint, which is kept for a driver that resolves nowhere (including Yarn PnP's "tried to access pg").
  
  - **@askdb/introspect**: new `@askdb/introspect/kit` subpath export (importable and requireable) with `createOptionalDriverLoader` / `isDriverInstalled` / `missingDriverMessage` (lazy optional-driver loading with the `resolveFrom` project-root fallback) and `rethrowDriverImportError` (chained on each engine's driver `import()` so bundlers such as esbuild keep treating the driver as an optional peer) (the loader treats only a missing driver package or entry point as "not installed", so a missing file inside an installed driver reports the real load error), `compileTableFilters` / `ambiguousFilterWarnings`, `makeTableId` / `makeColumnId`, `rowsToRecords`, `groupBy`, `buildOrderedGroups`, `byName`, `sortedUnique`, `mapFkAction`, and the connection-label helpers (`formatConnectionLabel`, `parseConnectionUrl`, `ConnectionLabelParts`).
  - **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlite**, **@askdb/sqlserver**, **@askdb/prisma**: internal refactor onto the kit — the private `glob.ts` / `ids.ts` copies, the per-engine driver loaders, and the row-folding helpers are gone. Public exports (`loadPgDriver`, `isPgDriverInstalled`, `loadMysql2Driver`, `postgresConnectorProvider`, …), error messages, and introspection output are unchanged.
  - **@askdb/connectors**: the connection-label helpers moved to `@askdb/introspect/kit`; `@askdb/connectors` re-exports them unchanged.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

### Patch Changes

- c55bfb3: Fix `askdb introspect --diff` reporting `changed: true` against an untouched artifact.
  
  `--diff` rendered its comparison body with `toV2SchemaJson(schema, schemaId)`, which dropped the connector-detected `provider` that `--out` writes, and it skipped the ID-anchored merge, so human-set `sensitive` flags in the existing `schema.json` also showed up as drift. In practice `--diff` said "changed" almost every time.
  
  **@askdb/introspect**: new pure `renderSchemaV2Body(schema, { schemaId, provider?, existingArtifactDir? })` returns `{ json, body, warnings }` — the exact bytes `renderToSchemaV2` writes, including the merge with an existing artifact. `renderToSchemaV2` now writes through it. New `isSchemaV2Json(value)` is the check applied to an existing `schema.json` before that merge: the shape the merge reads, including that each `sensitive` flag is a boolean when present, so a non-boolean flag is no longer copied into the new artifact.
  
  **askdb**: `--out`, `--print` and `--diff` all render through `renderSchemaV2Body`. `--diff` passes the connector's `provider` and merges with the existing artifact when the renderer accepts it as valid Schema v2 (an invalid `schema.json`, such as `{ "version": 2 }` with no tables, is compared without the merge and reported as changed, as before; any other merge error, such as malformed `tables/*.md` front matter, fails `--diff` the way it fails `--out`), and compares structurally so a key-reordered but equivalent file is not reported as changed.
- c55bfb3: **@askdb/mysql**: fix two introspection correctness bugs.
  
  - **Cross-database foreign keys** were rendered as if the referenced table were local (`REFERENCES billing.users` became a relationship to the introspected database's `users`). A foreign key into a database that isn't introspected (any other database without `filters.schemas`, or an unlisted one with it) has no target in the artifact, so it is now omitted and reported as a `cross_database_fk` warning naming the referenced database and table. Foreign keys into another listed database are kept, matching database names as the catalog spells them, so `--schemas Shop` on a server with case-insensitive names keeps the FKs of the database stored as `shop`.
  - **No database in the connection URL** (`mysql://user:pass@host:3306`) made `DATABASE()` NULL, so without `filters.schemas` every catalog query silently matched nothing and introspection produced an empty schema. It now throws a clear `AskDbError` asking for the database name in the URL path.
  
  **@askdb/introspect**: add the `cross_database_fk` variant to `IntrospectionWarning` (`{ code, table, constraint, referencedDatabase, referencedTable }`).
- 5e6b9fd: Apply the test campaign's plan for `@askdb/introspect` and `@askdb/prisma`: two weak tests can now fail for the regression they name, eight redundant tests fold into the tests that own their contract, and `isModuleResolutionFailure` is no longer exported from the kit's driver module (it was never reachable through the package `exports` map). No behavior or public API change.
- Updated dependencies [e7ea657]
- Updated dependencies [c610168]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [194de19]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [fa2e771]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
  - @askdb/core@1.0.0-beta.44

## 0.3.0-beta.17

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

## 0.3.0-beta.16

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42

## 0.3.0-beta.15

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/core@1.0.0-beta.41

## 0.3.0-beta.14

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40

## 0.3.0-beta.13

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36

## 0.3.0-beta.12

### Patch Changes

- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26

## 0.3.0-beta.11

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21

## 0.3.0-beta.10

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/core@1.0.0-beta.20

## 0.3.0-beta.9

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18

## 0.3.0-beta.8

### Patch Changes

- 49efa32: Include database views in rendered Schema v2 output. Views were already introspected by all four connectors but silently dropped during rendering.

## 0.3.0-beta.7

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16

## 0.3.0-beta.6

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14

## 0.3.0-beta.5

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/core@0.5.0-beta.12

## 0.3.0-beta.4

### Patch Changes

- cd364e3: Remove the `["public"]` default schema filter in the Postgres connector so that introspection now covers all non-system schemas by default. Previously, databases with tables in custom schemas (e.g. `audit`, `reporting`, `db_changelog`) were silently omitted unless the caller explicitly passed `filters.schemas`. Explicit `schemas` and `excludeSchemas` filters continue to work as before.

## 0.3.0-beta.3

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10

## 0.3.0-beta.2

### Patch Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4

## 0.3.0-beta.1

### Patch Changes

- 06e5f54: **Breaking for npm consumers:** the CLI is published as the unscoped package **`askdb`** (was `@askdb/cli`). Update `package.json` dependencies and install commands accordingly (`npm i askdb`, `npx askdb init`, etc.). The `askdb` binary name is unchanged.

  Also updates a `@askdb/config` bootstrap doc comment that referenced the old package name, plus README cross-links in `@askdb/introspect` and `@askdb/tui`.

## 0.3.0-beta.0

### Minor Changes

- 28d1b68: New workspace package: `@askdb/introspect` — schema introspection on the
  connector pattern. Phase 6 ships a Postgres connector, deterministic catalog
  SQL templates, live mode through the `AskDbExecutor` seam, air-gapped CSV/JSON
  export bundle ingestion, Schema v2 rendering, ID-anchored re-introspection
  merge, and the `askdb-introspect` CLI (`--url`, `--from-export`, `--out`,
  `--print`, `--diff`, and `templates`).

  The public surface includes `introspect()`, `renderToSchemaV2()`,
  `toV2SchemaJson()`, connector/types exports from `@askdb/introspect`, and the
  Postgres sub-export at `@askdb/introspect/postgres`.

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

- d9d69bb: Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

  `askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

  Document Prisma as an integration package alongside Postgres.

- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
