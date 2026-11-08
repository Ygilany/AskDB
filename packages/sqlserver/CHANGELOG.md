# @askdb/sqlserver

## 0.1.0-beta.28

### Patch Changes

- Updated dependencies [30d2348]
- Updated dependencies [4188c04]
- Updated dependencies [97312e1]
- Updated dependencies [39a4a5e]
- Updated dependencies [8069854]
- Updated dependencies [f11909c]
- Updated dependencies [4e79c4d]
- Updated dependencies [30d2348]
- Updated dependencies [4e79c4d]
- Updated dependencies [109c581]
- Updated dependencies [a7756fd]
  - @askdb/core@1.0.0-beta.52
  - @askdb/introspect@0.3.0-beta.26

## 0.1.0-beta.27

### Patch Changes

- Updated dependencies [6c8c88b]
- Updated dependencies [8e75d50]
- Updated dependencies [4196800]
  - @askdb/core@1.0.0-beta.51
  - @askdb/introspect@0.3.0-beta.25

## 0.1.0-beta.26

### Patch Changes

- a7f5f06: `MysqlIntrospectionInput`, `SqliteIntrospectionInput` and `SqlServerIntrospectionInput` are now aliases of `@askdb/introspect/kit`'s `LiveCatalogInput`, and each connector passes its input to `describe*` whole (#816). The shape is unchanged. A field added to `LiveCatalogInput` now reaches all three connectors, where each used to copy the fields by hand.
- Updated dependencies [88fe1c3]
- Updated dependencies [c501c5b]
- Updated dependencies [4b7f0d3]
- Updated dependencies [3797a5a]
- Updated dependencies [df612e9]
- Updated dependencies [42f9078]
- Updated dependencies [659cb75]
- Updated dependencies [7c00370]
- Updated dependencies [6ea4e72]
- Updated dependencies [ca606c2]
- Updated dependencies [dfc3716]
- Updated dependencies [a0d2ec2]
- Updated dependencies [1b9468d]
- Updated dependencies [0782a06]
- Updated dependencies [91e89ec]
  - @askdb/core@1.0.0-beta.50
  - @askdb/introspect@0.3.0-beta.24

## 0.1.0-beta.25

### Patch Changes

- 82c2f94: Every built-in connector adapter now passes `ConnectorConfig.schemaId` to its connector (#775). Only the Prisma adapter did, so `createConnector({ provider: "postgres" | "mysql" | "sqlite" | "sqlserver", schemaId })` returned a `SqlSchema` with `schemaId: "introspected"`. It now returns the ID you set, and `"introspected"` only when you set none. To carry it, `LiveCatalogInput`, `PostgresIntrospectionInput`, `MysqlIntrospectionInput`, `SqliteIntrospectionInput` and `SqlServerIntrospectionInput` gain an optional `schemaId`. `schema.json` is unchanged: it takes its ID from `RenderOptions.schemaId`.
- Updated dependencies [ca816cc]
- Updated dependencies [29a0fc1]
- Updated dependencies [396ad23]
- Updated dependencies [82c2f94]
- Updated dependencies [a8cef1b]
- Updated dependencies [4437394]
  - @askdb/core@1.0.0-beta.49
  - @askdb/introspect@0.3.0-beta.23

## 0.1.0-beta.24

### Patch Changes

- 31f90a3: `@askdb/sqlserver` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: every connection-string form connects with the same values, connection labels are the same, and the `mssql` driver loading works as before.
- c28c967: Declare `ai` as a peer, with the range `@askdb/core` requires (`^6.0.0 || ^7.0.51`), so Yarn Plug'n'Play passes your app's `ai` through to `@askdb/core` (#748). Before, core inside these packages couldn't reach `ai` under Plug'n'Play, and `yarn dlx askdb` crashed at startup. Core already required `ai` when it loads, so npm and pnpm install nothing new, and a host that already meets core's `ai` range meets this one.
- Updated dependencies [294ef92]
- Updated dependencies [f8f99cb]
- Updated dependencies [180f28a]
- Updated dependencies [9e49e34]
- Updated dependencies [b52a89f]
- Updated dependencies [229a592]
- Updated dependencies [1c31e95]
- Updated dependencies [c28c967]
  - @askdb/core@1.0.0-beta.48
  - @askdb/introspect@0.3.0-beta.22

## 0.1.0-beta.23

### Patch Changes

- Updated dependencies [f4e60a9]
- Updated dependencies [80c7ddf]
- Updated dependencies [0a94c6f]
- Updated dependencies [4f322db]
- Updated dependencies [4365d4c]
  - @askdb/core@1.0.0-beta.47
  - @askdb/introspect@0.3.0-beta.21

## 0.1.0-beta.22

### Minor Changes

- 8fbc115: Stop exporting the internal catalog SQL from the MySQL, SQLite and SQL Server packages, before the 1.0 API freeze (#275, ADR 0031). Each connector still runs the same queries; only the export is gone. `@askdb/postgres` keeps its `POSTGRES_TEMPLATE_BUNDLE`, because the air-gapped export flow runs those templates by hand.
  
  **Upgrade notes (breaking):**
  
  - `@askdb/mysql`: `MYSQL_CATALOG_SQL` is no longer exported, with no replacement.
  - `@askdb/sqlite`: `SQLITE_CATALOG_SQL` is no longer exported, with no replacement.
  - `@askdb/sqlserver`: `SQLSERVER_CATALOG_SQL` is no longer exported, with no replacement.
  
  These constants were undocumented and existed for the packages' own unit tests. To introspect, use the package's connector (`createMysqlConnector()`, `createSqliteConnector()`, `createSqlServerConnector()`) with its catalog query runner.
  
  Internal cleanup with no API change: `@askdb/sqlserver`'s `foldSqlServerResult` is now private to its module, as the MySQL and SQLite fold functions already are (#597). The packages reference page no longer says these three packages ship catalog SQL templates, and the upgrade notes list every export this release removes, with its replacement.

### Patch Changes

- 9ef4a6f: The `askdb introspect` error for a missing connection names only the `askdb.config` keys: `introspection.provider` set to the engine, and its `introspection.providerConfig.<engine>.databaseUrl` (or `.file` for SQLite). It no longer offers `ASKDB_INTROSPECT_*` or a `DATABASE_URL` fallback, which AskDB never reads from the environment (#281).
- Updated dependencies [47eef72]
- Updated dependencies [d82125c]
- Updated dependencies [b40309d]
- Updated dependencies [f3decbb]
- Updated dependencies [7ca1940]
- Updated dependencies [76dc3a3]
- Updated dependencies [234eec0]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [cdab7d7]
- Updated dependencies [ed7f35c]
- Updated dependencies [4d6a315]
- Updated dependencies [4d6a315]
  - @askdb/core@1.0.0-beta.46
  - @askdb/introspect@0.3.0-beta.20

## 0.1.0-beta.21

### Patch Changes

- Updated dependencies [c099a66]
- Updated dependencies [5bd780a]
- Updated dependencies [61f23b0]
- Updated dependencies [798cc4f]
- Updated dependencies [3d62eb5]
- Updated dependencies [aa187f2]
- Updated dependencies [e8afa01]
  - @askdb/core@1.0.0-beta.45
  - @askdb/introspect@0.3.0-beta.19

## 0.1.0-beta.20

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
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

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
- c55bfb3: Exclude objects shipped by SQL Server itself (`is_ms_shipped = 1`, e.g. replication `MS*` tables that live in `dbo`) from the table, view, and column catalog queries. The system-schema list alone did not catch them because they are not in a system schema.
- e88067d: Read Prisma's `{…}` escaping in Prisma-style `sqlserver://` connection URLs for a value that holds a `;`, and read Prisma's credential aliases.
  
  Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` read the braces as part of the value and split on the `;` inside them, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. A value that starts with `{`, has a `;` before its first `}`, and ends at the first `}` followed only by blanks and then a `;` or the end of the string, where the `;`-separated piece ending at that `}` has no `=`, is now an escape: everything between the braces is the value, read verbatim (`{{a;b}}` is `{a;b}`). The old parser cut such a value at its first `;` and skipped the piece holding the `}`, so it never connected with the value the user wrote.
  
  Prisma's credential aliases `username`, `uid` and `pwd` are read when `user` or `password` is absent (`username` before `uid`). Before, they were ignored, so such a string had no credentials. The canonical key still wins when both are set.
  
  Every other string connects with exactly the same values as before. Braces anywhere else are plain characters (`password={abc}` is still `{abc}`, an unclosed `{` is still part of the value, and a `{` never reaches into a later value, whether its braces close before any `;` (`password={ab}cd;user={me}`) or it has no `}` of its own (`password={Xy7;user={me}`)), as are an unbraced `=` in a value (`password=a=b`), non-ASCII, whitespace around keys and values, a lenient port, the last of repeated keys, and an unbraced `;` inside a value. `initial catalog` is still ignored. This differs from Prisma, which reads every `{…}` as an escape: a URL shared with Prisma that braces a value without a `;` (such as `password={Pass:Word}`) still sends that value with its braces.
- Updated dependencies [e7ea657]
- Updated dependencies [c610168]
- Updated dependencies [440054a]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [194de19]
- Updated dependencies [c55bfb3]
- Updated dependencies [1ca3eba]
- Updated dependencies [c55bfb3]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [fa2e771]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
- Updated dependencies [5e6b9fd]
  - @askdb/core@1.0.0-beta.44
  - @askdb/introspect@0.3.0-beta.18

## 0.1.0-beta.19

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

## 0.1.0-beta.18

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/connectors@0.1.0-beta.7
  - @askdb/introspect@0.3.0-beta.16

## 0.1.0-beta.17

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/core@1.0.0-beta.41
  - @askdb/introspect@0.3.0-beta.15
  - @askdb/connectors@0.1.0-beta.6

## 0.1.0-beta.16

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/introspect@0.3.0-beta.14
  - @askdb/connectors@0.1.0-beta.5

## 0.1.0-beta.15

### Patch Changes

- Updated dependencies [7311ac5]
  - @askdb/core@1.0.0-beta.36
  - @askdb/introspect@0.3.0-beta.13
  - @askdb/connectors@0.1.0-beta.4

## 0.1.0-beta.14

### Minor Changes

- 5affd84: **@askdb/{postgres,mysql,sqlite,sqlserver}**: Driver loaders (`createXxxCatalogQueryRunner`) now accept a `resolveFrom?: string` option for embedders that need to resolve the optional native peer from a directory other than `process.cwd()` (e.g. `@askdb/studio` running from an npx cache while the user project sits elsewhere). New `loadXxxDriver` and `isXxxDriverInstalled` helpers are exported for the same reason. `@askdb/sqlserver` additionally re-exports `resolveConnectionInput` and the `MssqlConfigInput` type so embedders can apply the same connection-string normalization the catalog runner uses. Behavior with no option / no helper import is unchanged.

  **@askdb/studio**: SQL Server query execution now routes the connection string through `@askdb/sqlserver`'s `resolveConnectionInput` before constructing the `mssql.ConnectionPool`. Fixes `Failed to connect to localhost:1433 - self-signed certificate` failures on ADO.NET connection strings that use the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default), and adds support for `mssql://` and Prisma-style `sqlserver://` URLs — matching the introspect path. Internal: the execute registry now delegates driver loading and per-engine connection-string normalization to the `@askdb/<engine>` packages instead of re-implementing them, eliminating the drift surface that caused the TLS regression in the first place.

## 0.1.0-beta.13

### Patch Changes

- e6caf41: Fix SQL Server introspection failing with `The "config.server" property is required and must be of type string` when using `mssql://` or `sqlserver://` URL formats, and fix `Trust Server Certificate` (with spaces) being silently dropped from ADO.NET connection strings.

  **Root causes:**
  - mssql v12 switched to `@tediousjs/connection-string`, a pure ADO.NET `Key=Value;` parser. URL-format strings (`mssql://…`) silently produce an empty config — `server` is never set, causing the error at connect time.
  - `@tediousjs/connection-string` v1.x schema keys omit spaces (`trustservercertificate`) but ADO.NET clients like VS Code's mssql extension emit them with spaces (`Trust Server Certificate`). After lowercasing the keys never match, so the option is dropped and TLS verification fails.

  **Fixes:**
  - `mssql://user:pass@host:1433/db` — parsed via `new URL()` into a config object.
  - `sqlserver://host:1433;database=db;user=u;password=p` (Prisma format) — custom semicolon-separated parser.
  - ADO.NET strings — multi-word keys normalised to their camelCase/no-space equivalents before passing to mssql (`Trust Server Certificate` → `TrustServerCertificate`, `Application Intent` → `ApplicationIntent`, etc.).

## 0.1.0-beta.12

### Patch Changes

- dc380bc: Remove direct `pg` runtime dependencies from bundled app surfaces and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.

## 0.1.0-beta.11

### Patch Changes

- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26
  - @askdb/introspect@0.3.0-beta.12
  - @askdb/connectors@0.1.0-beta.3

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/introspect@0.3.0-beta.11
  - @askdb/connectors@0.1.0-beta.2

## 0.1.0-beta.9

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

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/introspect@0.3.0-beta.9

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [49efa32]
  - @askdb/introspect@0.3.0-beta.8

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16
  - @askdb/introspect@0.3.0-beta.7

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14
  - @askdb/introspect@0.3.0-beta.6

## 0.1.0-beta.4

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/core@0.5.0-beta.12
  - @askdb/introspect@0.3.0-beta.5

## 0.1.0-beta.3

### Patch Changes

- Updated dependencies [cd364e3]
  - @askdb/introspect@0.3.0-beta.4

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10
  - @askdb/introspect@0.3.0-beta.3

## 0.1.0-beta.1

### Minor Changes

- 5ac67fc: **Ship `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` — direct introspection connectors for the non-Postgres relational engines.** Each package pairs with its `DialectSpec` in `@askdb/core` and exposes the same shape as `@askdb/postgres`: a `Connector` for `@askdb/introspect`, a live catalog query runner backed by the engine's standard driver, and the matching dialect re-export for convenience.
  - `@askdb/mysql` — introspects via `information_schema` (tables, columns, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mysql2`. Exports `createMysqlConnector`, `createMysqlCatalogQueryRunner`, `describeMysql`, `MYSQL_DIALECT`, `MARIADB_DIALECT`.
  - `@askdb/sqlite` — introspects via `sqlite_master` and the `pragma_*` table-valued functions (SQLite ≥ 3.16). Optional peer: `better-sqlite3`. Exports `createSqliteConnector`, `createSqliteCatalogQueryRunner`, `describeSqlite`, `SQLITE_DIALECT`.
  - `@askdb/sqlserver` — introspects via `sys.*` catalog views (schemas, tables, columns with precision/scale rendering, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mssql`. System schemas (`sys`, `INFORMATION_SCHEMA`, `db_*`, `guest`) are excluded by default. Exports `createSqlServerConnector`, `createSqlServerCatalogQueryRunner`, `describeSqlServer`, `SQLSERVER_DIALECT`.

  **CLI: `askdb introspect --engine mysql|sqlite|sqlserver`.** The CLI now wires the three new connectors behind `--engine`. Live mode only (no `--from-export` yet); `--url` carries the driver-native connection string for MySQL/SQL Server and the file path for SQLite. The shipped `provider` is persisted into `schema.json`, so `askdb ask` continues to auto-pick the matching dialect without further configuration.

  **Scope notes.** v1 surfaces tables, views, columns (with engine-correct type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes. Comments / default expressions / SQLite check constraints are not yet captured for these engines — follow-ups will close gaps as needed. From-export bundle mode and `askdb introspect templates` remain Postgres-only for now.

### Patch Changes

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4
  - @askdb/introspect@0.3.0-beta.2
