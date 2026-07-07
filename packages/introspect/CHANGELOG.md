# @askdb/introspect

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
