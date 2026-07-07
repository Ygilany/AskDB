# @askdb/postgres

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
