# @askdb/prisma

## 0.2.0-beta.12

### Patch Changes

- @askdb/introspect@0.3.0-beta.12
- @askdb/connectors@0.1.0-beta.3

## 0.2.0-beta.11

### Patch Changes

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
  - @askdb/connectors@0.1.0-beta.1
  - @askdb/introspect@0.3.0-beta.10

## 0.2.0-beta.9

### Patch Changes

- @askdb/introspect@0.3.0-beta.9

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [49efa32]
  - @askdb/introspect@0.3.0-beta.8

## 0.2.0-beta.7

### Patch Changes

- @askdb/introspect@0.3.0-beta.7

## 0.2.0-beta.6

### Patch Changes

- @askdb/introspect@0.3.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- @askdb/introspect@0.3.0-beta.5

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies [cd364e3]
  - @askdb/introspect@0.3.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- @askdb/introspect@0.3.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- 57db375: **Discriminated union types for `ai` and `introspection` in `AskDbConfig`** — each `provider` value now enforces exactly the right `providerConfig` branch at compile time (e.g. `provider: "openai"` requires `providerConfig: { openai: OpenaiConfig }` and rejects any other key). Named branch types are exported: `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `AskDbAiConfig`, `PostgresIntrospectionConfig`, `PrismaIntrospectionConfig`, `AskDbIntrospectionConfig`.

  **Prisma schema auto-discovery in `@askdb/prisma`** — `discoverPrismaSchemaPath()` is now exported and probes `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file) in order. Setting `introspection.provider: "prisma"` is now sufficient without an explicit `schemaPath`; the path can still be set via `introspection.providerConfig.prisma.schemaPath` to override discovery.

  **`ASKDB_PRISMA_SCHEMA` env var removed** — the Prisma schema path is read from the bootstrapped structured config (`getAskDbRuntimeConfig().introspection.prismaSchemaPath`) instead of a flat env key. `AskDbRuntimeConfig` gains a typed `introspection` field with `provider`, `prismaSchemaPath`, and `outputDir`.

  **`RUNTIME_SHELL_FLAT_OVERRIDES` removed from bootstrap** — `askdb.config.*` is now the sole source of truth; use `env("VAR")` inside the config file to read from shell or `.env` at load time.

### Patch Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- Updated dependencies [eb325a2]
  - @askdb/introspect@0.3.0-beta.2

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/introspect@0.3.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- d9d69bb: Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

  `askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

  Document Prisma as an integration package alongside Postgres.

### Patch Changes

- Updated dependencies [28d1b68]
- Updated dependencies [a90543b]
- Updated dependencies [d9d69bb]
- Updated dependencies [4e462eb]
  - @askdb/introspect@0.3.0-beta.0
