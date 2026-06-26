# askdb

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [e6caf41]
  - @askdb/sqlserver@0.1.0-beta.13

## 1.0.0-beta.30

### Minor Changes

- 6b22dcb: feat(cli): `askdb init` is now a setup wizard that writes a tailored config and installs selected packages

  - In a TTY, `askdb init` opens a short interactive wizard (powered by `@inquirer/prompts`, lazy-loaded) that asks which database, AI provider, RAG store, and Studio execute mode you want. It then generates only the relevant config branches and installs only the packages for your chosen path.
  - In CI and scripts, `askdb init --yes` runs silently with Postgres + OpenAI defaults. All wizard choices are also available as flags (`--database`, `--ai-provider`, `--rag-store`, `--studio-execute`, etc.).
  - The generated `askdb.config.ts` includes only the selected `introspection.providerConfig` branch, the selected AI `providerConfig` branch, and the selected RAG `storeConfig` branch — no more deleting unused sections.
  - The install plan is exact: SQL Server setups install `mssql`; SQLite setups install `better-sqlite3`; Prisma-only setups install no live DB driver unless Studio execute is enabled.
  - `@inquirer/prompts` is added as a runtime dependency but is only imported when entering interactive mode.

### Patch Changes

- dc380bc: Remove direct `pg` runtime dependencies from bundled app surfaces and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.
- Updated dependencies [dc380bc]
- Updated dependencies [dc380bc]
  - @askdb/postgres@0.2.0-beta.13
  - @askdb/mysql@0.1.0-beta.12
  - @askdb/sqlite@0.1.0-beta.12
  - @askdb/sqlserver@0.1.0-beta.12
  - @askdb/studio@0.2.0-beta.25
  - @askdb/config@1.0.0-beta.9
  - @askdb/client@1.0.0-beta.2
  - @askdb/tui@0.2.0-beta.16

## 1.0.0-beta.29

### Patch Changes

- 354c833: Resolve schema, model, and dialect via the new `@askdb/client` facade instead of duplicating the logic in each host. No behavior change: same dialect precedence, mock-SQL path, and error responses.
- Updated dependencies [354c833]
- Updated dependencies [354c833]
  - @askdb/client@0.1.0-beta.1

## 1.0.0-beta.27

### Minor Changes

- d4a0a1d: Add Anthropic Claude as a supported AI provider, open the config provider union for custom adapters, and make the key-missing message registry-driven.

  **New package: `@askdb/ai-anthropic`** — Set `ASKDB_AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Anthropic Claude models. The default model is `claude-sonnet-4-6`; override with `ASKDB_AI_MODEL` or `ANTHROPIC_MODEL`. The `anthropic` provider is also configurable via `askdb.config.*` using the new `providerConfig.anthropic` branch (`apiKey`, `model`, `baseUrl`). Anthropic has no embeddings API; `createEmbeddingModel` throws a clear error directing you to configure a separate embedding provider.

  **Registry-driven key-missing message (`@askdb/ai`)** — `AiProviderAdapter` gains an optional `configHint` field. `AiRegistry` gains `keyMissingMessage(context)` that assembles hints from all registered adapters (deduplicated across aliases, stable registration order). The static `aiKeyMissingMessage` export is deprecated in favor of `ai.keyMissingMessage(context)`. All four surfaces (CLI, HTTP API, Studio, TUI) now use the registry method so Anthropic (and any future adapter) is automatically mentioned.

  **Custom provider config branch (`@askdb/config`)** — `AskDbAiConfig` now accepts any provider string, not just the four known literals. Known literals still get dedicated branches with required `providerConfig`; any other string falls through to the new `CustomAiConfig` branch, which flattens to the universal `ASKDB_AI_*` env keys. Custom providers only work end to end when the host registry contains an adapter registered under that provider name — the first-party apps register only first-party adapters.

- 4dd7a59: Make AI provider adapters self-describing. Standalone `resolveAiConfig` and
  `resolveEmbeddingConfig` moved onto `createAiRegistry()` registry instances, and
  adapters now own their native env vars, aliases, defaults, and provider-specific
  connection options.

  `AiConfig.resourceName` and `AiConfig.apiVersion` were replaced by
  `AiConfig.providerOptions`; Azure reads `resourceName` and `apiVersion` from
  that bag. The `ai` package is now a peer dependency of `@askdb/ai` and all
  first-party AI adapter packages.

  Google behavior is now provider-correct: it no longer falls back to
  `OPENAI_API_KEY_SECONDARY`, its default language model is `gemini-2.0-flash`,
  and embeddings require an explicit Google embedding model instead of falling
  back to OpenAI's `text-embedding-3-small`.

### Patch Changes

- c0603e1: Resolve the runtime introspection output directory through `@askdb/config` and use it when **`askdb ask`** omits **`--schema`**. Pass **`--schema <path>`** to override.
- Updated dependencies [d4a0a1d]
- Updated dependencies [4dd7a59]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
- Updated dependencies [96e6963]
  - @askdb/ai-anthropic@1.0.0-beta.1
  - @askdb/ai@0.1.0-beta.3
  - @askdb/config@1.0.0-beta.8
  - @askdb/studio@0.2.0-beta.24
  - @askdb/tui@0.2.0-beta.15
  - @askdb/ai-openai@1.0.0-beta.3
  - @askdb/ai-azure@1.0.0-beta.3
  - @askdb/ai-google@1.0.0-beta.3

## 1.0.0-beta.26

### Patch Changes

- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
- Updated dependencies [baf5ad8]
- Updated dependencies [999ba36]
- Updated dependencies [baf5ad8]
  - @askdb/ai@0.1.0-beta.2
  - @askdb/ai-openai@0.1.0-beta.2
  - @askdb/ai-azure@0.1.0-beta.2
  - @askdb/studio@0.2.0-beta.23
  - @askdb/ai-google@0.1.0-beta.2
  - @askdb/core@1.0.0-beta.26
  - @askdb/mysql@0.1.0-beta.11
  - @askdb/postgres@0.2.0-beta.12
  - @askdb/tui@0.2.0-beta.14
  - @askdb/introspect@0.3.0-beta.12
  - @askdb/sqlite@0.1.0-beta.11
  - @askdb/sqlserver@0.1.0-beta.11
  - @askdb/connectors@0.1.0-beta.3
  - @askdb/prisma@0.2.0-beta.12

## 1.0.0-beta.25

### Patch Changes

- Updated dependencies [8371033]
  - @askdb/studio@0.2.0-beta.22

## 1.0.0-beta.24

### Patch Changes

- Updated dependencies [05a589a]
  - @askdb/studio@0.2.0-beta.21
  - @askdb/config@1.0.0-beta.7
  - @askdb/tui@0.2.0-beta.13

## 1.0.0-beta.23

### Patch Changes

- Updated dependencies [e4716c2]
- Updated dependencies [3ca848a]
  - @askdb/studio@0.2.0-beta.20

## 1.0.0-beta.22

### Patch Changes

- Updated dependencies [330e1d2]
- Updated dependencies [e3616e5]
- Updated dependencies [93a4c26]
  - @askdb/studio@0.2.0-beta.19

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/studio@0.2.0-beta.18
  - @askdb/introspect@0.3.0-beta.11
  - @askdb/mysql@0.1.0-beta.10
  - @askdb/postgres@0.2.0-beta.11
  - @askdb/sqlite@0.1.0-beta.10
  - @askdb/sqlserver@0.1.0-beta.10
  - @askdb/tui@0.2.0-beta.12
  - @askdb/connectors@0.1.0-beta.2
  - @askdb/prisma@0.2.0-beta.11

## 1.0.0-beta.20

### Patch Changes

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

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/connectors@0.1.0-beta.1
  - @askdb/postgres@0.2.0-beta.10
  - @askdb/mysql@0.1.0-beta.9
  - @askdb/sqlite@0.1.0-beta.9
  - @askdb/sqlserver@0.1.0-beta.9
  - @askdb/prisma@0.2.0-beta.10
  - @askdb/ai@0.1.0-beta.1
  - @askdb/ai-openai@0.1.0-beta.1
  - @askdb/ai-azure@0.1.0-beta.1
  - @askdb/ai-google@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20
  - @askdb/studio@0.2.0-beta.17
  - @askdb/tui@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.10

## 1.0.0-beta.19

### Major Changes

- 1eacf3f: Remove `database` config section; move connection URLs into `introspection` and `studio`.

  **Breaking:** `AskDbConfig.database` is removed. Move the Postgres connection URL from `database.providerConfig.postgres.databaseUrl` into `introspection.providerConfig.postgres.databaseUrl` (maps to `ASKDB_INTROSPECT_POSTGRES_URL`). The generic `DATABASE_URL` flat key is no longer set by `flattenAskDbConfig`.

  **Breaking:** Studio query execution (`POST /api/execute`) now reads `ASKDB_STUDIO_DATABASE_URL` instead of `DATABASE_URL`. Set `studio.execute.databaseUrl` in `askdb.config.*` (maps to `ASKDB_STUDIO_DATABASE_URL`).

  `AskDbRuntimeIntrospectionConfig` gains a new `postgresDatabaseUrl` field. The `DATABASE_URL` fallback for MySQL and SQL Server introspection is removed; configure those URLs explicitly via `introspection.providerConfig.<engine>.databaseUrl` or `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLSERVER_URL`.

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6
  - @askdb/studio@0.2.0-beta.16
  - @askdb/tui@0.2.0-beta.10

## 0.5.0-beta.18

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/studio@0.2.0-beta.15
  - @askdb/introspect@0.3.0-beta.9
  - @askdb/mysql@0.1.0-beta.8
  - @askdb/postgres@0.2.0-beta.9
  - @askdb/sqlite@0.1.0-beta.8
  - @askdb/sqlserver@0.1.0-beta.8
  - @askdb/tui@0.2.0-beta.9
  - @askdb/prisma@0.2.0-beta.9

## 0.5.0-beta.17

### Patch Changes

- Updated dependencies [49efa32]
- Updated dependencies [75a51f7]
  - @askdb/introspect@0.3.0-beta.8
  - @askdb/studio@0.2.0-beta.14
  - @askdb/mysql@0.1.0-beta.7
  - @askdb/postgres@0.2.0-beta.8
  - @askdb/prisma@0.2.0-beta.8
  - @askdb/sqlite@0.1.0-beta.7
  - @askdb/sqlserver@0.1.0-beta.7

## 0.5.0-beta.16

### Patch Changes

- Updated dependencies [36c35b4]
- Updated dependencies [b791213]
- Updated dependencies [f314b37]
- Updated dependencies [0d0040a]
  - @askdb/studio@0.2.0-beta.13
  - @askdb/core@0.5.0-beta.16
  - @askdb/introspect@0.3.0-beta.7
  - @askdb/mysql@0.1.0-beta.6
  - @askdb/postgres@0.2.0-beta.7
  - @askdb/sqlite@0.1.0-beta.6
  - @askdb/sqlserver@0.1.0-beta.6
  - @askdb/tui@0.2.0-beta.8
  - @askdb/prisma@0.2.0-beta.7

## 0.5.0-beta.15

### Patch Changes

- Updated dependencies [4d8d87f]
  - @askdb/studio@0.2.0-beta.12

## 0.5.0-beta.14

### Patch Changes

- Updated dependencies [c3c0f21]
- Updated dependencies [d220e9f]
- Updated dependencies [c7026a8]
  - @askdb/core@0.5.0-beta.14
  - @askdb/tui@0.2.0-beta.7
  - @askdb/studio@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.6
  - @askdb/mysql@0.1.0-beta.5
  - @askdb/postgres@0.2.0-beta.6
  - @askdb/sqlite@0.1.0-beta.5
  - @askdb/sqlserver@0.1.0-beta.5
  - @askdb/prisma@0.2.0-beta.6

## 0.5.0-beta.13

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5
  - @askdb/studio@0.2.0-beta.10
  - @askdb/tui@0.2.0-beta.6

## 0.5.0-beta.12

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12
  - @askdb/studio@0.2.0-beta.9
  - @askdb/tui@0.2.0-beta.5
  - @askdb/introspect@0.3.0-beta.5
  - @askdb/mysql@0.1.0-beta.4
  - @askdb/postgres@0.2.0-beta.5
  - @askdb/sqlite@0.1.0-beta.4
  - @askdb/sqlserver@0.1.0-beta.4
  - @askdb/prisma@0.2.0-beta.5

## 0.5.0-beta.11

### Patch Changes

- Updated dependencies [cd364e3]
- Updated dependencies [eff2f5d]
  - @askdb/postgres@0.2.0-beta.4
  - @askdb/introspect@0.3.0-beta.4
  - @askdb/studio@0.2.0-beta.8
  - @askdb/mysql@0.1.0-beta.3
  - @askdb/prisma@0.2.0-beta.4
  - @askdb/sqlite@0.1.0-beta.3
  - @askdb/sqlserver@0.1.0-beta.3

## 0.5.0-beta.10

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10
  - @askdb/studio@0.2.0-beta.7
  - @askdb/tui@0.2.0-beta.4
  - @askdb/introspect@0.3.0-beta.3
  - @askdb/mysql@0.1.0-beta.2
  - @askdb/postgres@0.2.0-beta.3
  - @askdb/sqlite@0.1.0-beta.2
  - @askdb/sqlserver@0.1.0-beta.2
  - @askdb/prisma@0.2.0-beta.3

## 0.5.0-beta.9

### Patch Changes

- Updated dependencies [0084012]
  - @askdb/studio@0.2.0-beta.6

## 0.5.0-beta.8

### Patch Changes

- @askdb/studio@0.2.0-beta.5

## 0.5.0-beta.7

### Patch Changes

- Updated dependencies [52cfa58]
  - @askdb/studio@0.2.0-beta.4

## 0.5.0-beta.6

### Patch Changes

- Updated dependencies [9c01a6d]
  - @askdb/tui@0.2.0-beta.3
  - @askdb/studio@0.2.0-beta.3

## 0.5.0-beta.5

### Patch Changes

- 1a3c63e: Align the `askdb init` generated `askdb.config.ts` template with the repo root config: canonical env names (`OPENAI_API_KEY`, `DATABASE_URL`, etc.), OpenAI RAG + file store defaults, and `logging`, `dev`, `tui`, `studio`, and `httpApi` sections.

## 0.5.0-beta.4

### Minor Changes

- 07dbc9a: **`askdb.config.ts` now configures MySQL / SQLite / SQL Server directly — no `--engine` flag required.**

  Adds three new discriminated-union branches to `AskDbIntrospectionConfig`, matching the existing postgres / prisma shape:

  ```ts
  introspection: {
    provider: "mysql",
    providerConfig: { mysql: { databaseUrl: env("DATABASE_URL") } },
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlite",
    providerConfig: { sqlite: { file: "./data/app.db" } },  // path, not URL
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlserver",
    providerConfig: { sqlserver: { databaseUrl: env("MSSQL_URL") } },
    outputDir: "./askdb/",
  }
  ```

  **Resolution ladder** per engine — first non-empty value wins:
  1. `introspection.providerConfig.<engine>.<field>` (structured)
  2. Provider-specific env key: `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLITE_FILE` / `ASKDB_INTROSPECT_SQLSERVER_URL`
  3. `DATABASE_URL` fallback — **for MySQL and SQL Server only**. SQLite has no `DATABASE_URL` fallback because file paths and URLs aren't interchangeable.

  **Runtime view.** `AskDbRuntimeIntrospectionConfig` gains resolved per-engine fields:

  ```ts
  introspection: {
    provider: AskDbIntrospectionProvider; // widened to all 5 ids
    prismaSchemaPath: string | undefined;
    mysqlDatabaseUrl: string | undefined;
    sqliteFile: string | undefined;
    sqlserverDatabaseUrl: string | undefined;
    outputDir: string | undefined;
  }
  ```

  **CLI.** `askdb introspect` now defaults `--engine` to `rt.introspection.provider` when the flag isn't passed, so `askdb introspect` works flag-free for every configured engine. Error messages name all three configuration paths (structured / env key / `DATABASE_URL`) so the precedence is discoverable.

  **The `database` block stays Postgres-only** — it's the RAG / pgvector home and isn't widened in this change. Non-Postgres introspection is self-contained inside its own `introspection` branch.

  **Compatibility.** Strictly additive. Existing configs continue to type-check and behave identically; the only widening user code sees is `AskDbRuntimeIntrospectionConfig.provider`, which goes from `"postgres" | "prisma"` to all five ids.

- 5ac67fc: **Ship `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` — direct introspection connectors for the non-Postgres relational engines.** Each package pairs with its `DialectSpec` in `@askdb/core` and exposes the same shape as `@askdb/postgres`: a `Connector` for `@askdb/introspect`, a live catalog query runner backed by the engine's standard driver, and the matching dialect re-export for convenience.
  - `@askdb/mysql` — introspects via `information_schema` (tables, columns, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mysql2`. Exports `createMysqlConnector`, `createMysqlCatalogQueryRunner`, `describeMysql`, `MYSQL_DIALECT`, `MARIADB_DIALECT`.
  - `@askdb/sqlite` — introspects via `sqlite_master` and the `pragma_*` table-valued functions (SQLite ≥ 3.16). Optional peer: `better-sqlite3`. Exports `createSqliteConnector`, `createSqliteCatalogQueryRunner`, `describeSqlite`, `SQLITE_DIALECT`.
  - `@askdb/sqlserver` — introspects via `sys.*` catalog views (schemas, tables, columns with precision/scale rendering, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mssql`. System schemas (`sys`, `INFORMATION_SCHEMA`, `db_*`, `guest`) are excluded by default. Exports `createSqlServerConnector`, `createSqlServerCatalogQueryRunner`, `describeSqlServer`, `SQLSERVER_DIALECT`.

  **CLI: `askdb introspect --engine mysql|sqlite|sqlserver`.** The CLI now wires the three new connectors behind `--engine`. Live mode only (no `--from-export` yet); `--url` carries the driver-native connection string for MySQL/SQL Server and the file path for SQLite. The shipped `provider` is persisted into `schema.json`, so `askdb ask` continues to auto-pick the matching dialect without further configuration.

  **Scope notes.** v1 surfaces tables, views, columns (with engine-correct type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes. Comments / default expressions / SQLite check constraints are not yet captured for these engines — follow-ups will close gaps as needed. From-export bundle mode and `askdb introspect templates` remain Postgres-only for now.

### Patch Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- 57db375: **Discriminated union types for `ai` and `introspection` in `AskDbConfig`** — each `provider` value now enforces exactly the right `providerConfig` branch at compile time (e.g. `provider: "openai"` requires `providerConfig: { openai: OpenaiConfig }` and rejects any other key). Named branch types are exported: `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `AskDbAiConfig`, `PostgresIntrospectionConfig`, `PrismaIntrospectionConfig`, `AskDbIntrospectionConfig`.

  **Prisma schema auto-discovery in `@askdb/prisma`** — `discoverPrismaSchemaPath()` is now exported and probes `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file) in order. Setting `introspection.provider: "prisma"` is now sufficient without an explicit `schemaPath`; the path can still be set via `introspection.providerConfig.prisma.schemaPath` to override discovery.

  **`ASKDB_PRISMA_SCHEMA` env var removed** — the Prisma schema path is read from the bootstrapped structured config (`getAskDbRuntimeConfig().introspection.prismaSchemaPath`) instead of a flat env key. `AskDbRuntimeConfig` gains a typed `introspection` field with `provider`, `prismaSchemaPath`, and `outputDir`.

  **`RUNTIME_SHELL_FLAT_OVERRIDES` removed from bootstrap** — `askdb.config.*` is now the sole source of truth; use `env("VAR")` inside the config file to read from shell or `.env` at load time.

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [5ac67fc]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/sqlite@0.1.0-beta.1
  - @askdb/core@0.5.0-beta.4
  - @askdb/postgres@0.2.0-beta.2
  - @askdb/introspect@0.3.0-beta.2
  - @askdb/prisma@0.2.0-beta.2
  - @askdb/mysql@0.1.0-beta.1
  - @askdb/sqlserver@0.1.0-beta.1
  - @askdb/studio@0.2.0-beta.2
  - @askdb/tui@0.2.0-beta.2

## 0.5.0-beta.3

### Patch Changes

- e604123: Running **`askdb introspect`** with no extra arguments now performs a Postgres introspection using **`DATABASE_URL`** and **`ASKDB_INTROSPECT_OUT`** from the bootstrapped `askdb.config` snapshot instead of printing usage. Use **`--help`** for the command reference.

## 0.5.0-beta.2

### Patch Changes

- cadd642: `askdb init` now installs **`@askdb/config`** and **`dotenv`** in the nearest non-workspace package (detects pnpm / npm / yarn / bun via lockfiles). Workspace roots get copy-paste install instructions instead. Add **`--skip-install`** to only write `askdb.config.ts`.

## 0.5.0-beta.1

### Minor Changes

- 06e5f54: **Breaking for npm consumers:** the CLI is published as the unscoped package **`askdb`** (was `@askdb/cli`). Update `package.json` dependencies and install commands accordingly (`npm i askdb`, `npx askdb init`, etc.). The `askdb` binary name is unchanged.

  Also updates a `@askdb/config` bootstrap doc comment that referenced the old package name, plus README cross-links in `@askdb/introspect` and `@askdb/tui`.

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1
  - @askdb/introspect@0.3.0-beta.1
  - @askdb/tui@0.2.0-beta.1
  - @askdb/studio@0.2.0-beta.1
  - @askdb/postgres@0.2.0-beta.1
  - @askdb/prisma@0.2.0-beta.1

## 0.5.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 48bfb62: Add `@askdb/studio`, a local browser UI for Schema v2 enrichment. Studio can browse tables and columns, edit describable metadata, save `tables/*.md`, request AI enrichment suggestions with the configured OpenAI-compatible key, and generate sample NL-to-SQL output against the saved schema enrichment.

  The main CLI now exposes `askdb studio --schema <dir>` as a shim for the Studio app. The shared TUI workspace save helper now creates `tables/` when needed so first-time describable files can be written from both UI surfaces.

- 289e63e: First public pre-1.0 release.

  `@askdb/core` ships the NL→SQL pipeline (`ask`), the BYO executor seam
  (`AskDbExecutor`, `TabularResult`), and the validated read-only PostgreSQL
  guardrail. `pg` is an **optional peer dependency** — consumers using a custom
  `executor` never need to install it. The built-in helpers live behind the
  `@askdb/core/postgres` subpath and lazy-load `pg` on first invocation, with a
  helpful error if the peer is missing.

  `askdb` (`askdb` binary) and `@askdb/http-api` (`askdb-http` binary,
  `POST /ask`) are thin wrappers over `@askdb/core` and ship together at the
  same version.

  This is the first version published to npm; semver applies to
  `packages/*/src/index.ts` exports and `docs/contracts/` going forward.

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
  - The `askdb-introspect` standalone binary and the `@askdb/introspect/cli` and `@askdb/introspect/postgres` subpaths are removed. Use `askdb introspect` from `askdb`, and import the connector from `@askdb/postgres`.

  **New — `@askdb/postgres`**
  - New package bundling the Postgres dialect (`postgresDialect`, `generatePostgresSelectSql`, `validatePostgresSelectSql`), the connector (`createPostgresConnector`, live + from-export), the catalog SQL suite (`POSTGRES_TEMPLATE_BUNDLE`), the bundle reader, and the `pg`-backed catalog runner (`createPostgresCatalogQueryRunner`).
  - `pg` is an optional peer dependency, lazy-loaded only when live catalog introspection is invoked.

  **Pre-1.0 breaking — apps**
  - `askdb` now wires `postgresDialect` internally. The `askdb introspect` subcommand replaces the retired `askdb-introspect` binary.
  - `@askdb/http-api` no longer accepts execution controls or `connectionString` in request bodies. It returns generated SQL only.
  - `apps/{cli,http-api,tui,docs-site}` moved from `packages/*` to `apps/*`. Repository `directory` metadata updated accordingly.

- fdfd059: Add the Phase 7 `@askdb/tui` enrichment package and CLI shims.

  `@askdb/tui` provides the `askdb-tui` binary for editing Schema v2 table descriptions,
  aliases, column metadata, common query language, example questions, and concepts.
  It includes AI suggestion helpers with human confirm-before-save and a `bundle`
  command that emits loader-compatible single-file Schema v2 JSON artifacts.

  `@askdb/core` now exports enrichment-suggestion prompt helpers for BYO
  `LanguageModel` integrations. `askdb` adds `askdb enrich` and `askdb bundle`
  shims that delegate to `askdb-tui` when installed.

- d9d69bb: Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

  `askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

  Document Prisma as an integration package alongside Postgres.

- 4e462eb: Remove generated-SQL execution from AskDB package surfaces.
  - `@askdb/core` no longer exports `AskDbExecutor` / `TabularResult`, no longer accepts `execute` or `executor`, and `ask()` now returns generated SQL only.
  - `@askdb/introspect` now owns the introspection-only `CatalogQueryRunner` / `CatalogQueryResult` contract for connector catalog reads.
  - `@askdb/postgres` replaces `createPostgresExecutor` / `executeReadOnlySelect` with `createPostgresCatalogQueryRunner` for live introspection.
  - `askdb` and `@askdb/http-api` no longer execute generated SQL; old execution controls are rejected.

- cd23f50: **Breaking change (pre-1.0):** Schema v2 replaces the previous format. `loadSchema()` and `loadSchemaFromJson()` are the new entry points; the pre-v2 format is rejected with a clear error pointing at `docs/contracts/schema-v2.md`.

  New exports: `loadSchema`, `loadSchemaFromJson`, `parseTableMarkdown`, `parseConceptsMarkdown`, `writeTableMarkdown`, `writeConceptsMarkdown`, `formatSchemaV2ForNlToSql`, and all v2 types. `ask()` now accepts both `NormalizedSchema` (legacy) and `NormalizedSchemaV2`.

  CLI and HTTP API transparently pick up Schema v2 — pass a v2 directory path to `--schema` / `ASKDB_SCHEMA_PATH`.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- 25980e4: Centralize optional `askdb.config` defaults in `flattenAskDbConfig` instead of `optionalEnv`. `env()` now returns `undefined` when unset; add `requiredEnv` for fail-fast reads. Introduce `defaults.ts`, align the default RAG file-store path with `./askdb/rag`, and emit `ASKDB_PGVECTOR_INDEX_STRATEGY` when flattening pgvector. Refresh the `askdb init` template, root `askdb.config.ts`, and documentation.
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [48bfb62]
- Updated dependencies [25980e4]
- Updated dependencies [373e152]
- Updated dependencies [ec3ae3d]
- Updated dependencies [289e63e]
- Updated dependencies [28d1b68]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [d9d69bb]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
- Updated dependencies [6df0045]
- Updated dependencies [daa2625]
- Updated dependencies [767fcf2]
- Updated dependencies [373a9a7]
- Updated dependencies [6df0045]
  - @askdb/core@0.5.0-beta.0
  - @askdb/studio@0.2.0-beta.0
  - @askdb/tui@0.2.0-beta.0
  - @askdb/config@0.3.0-beta.0
  - @askdb/postgres@0.2.0-beta.0
  - @askdb/introspect@0.3.0-beta.0
  - @askdb/prisma@0.2.0-beta.0
