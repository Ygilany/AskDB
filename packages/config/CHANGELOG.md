# @askdb/config

## 1.0.0-beta.9

### Minor Changes

- dc380bc: Add multi-dialect execute support to Studio Query Playground and expose driver-readiness status.

  **`@askdb/config`** — `studio.execute` gains a `provider` field (`"postgres" | "mysql" | "sqlite" | "sqlserver"`) and a `file` field for SQLite. The runtime config resolves the execute provider from: explicit `studio.execute.provider` → active introspection provider (when it is a live engine) → `"postgres"` (backward-compatible default). Connection resolution per provider: Postgres and MySQL and SQL Server use `databaseUrl` (falling back to their introspection URL); SQLite uses `file` (falling back to the introspection file). New canonical env keys: `ASKDB_STUDIO_EXECUTE_PROVIDER` and `ASKDB_STUDIO_SQLITE_FILE`. `ASKDB_STUDIO_DATABASE_URL` is preserved for backward compatibility. New constants: `ASKDB_STUDIO_EXECUTE_PROVIDERS`, `AskDbStudioExecuteProvider`.

  **`@askdb/studio`** — Studio can now execute SQL against Postgres, MySQL, SQLite, and SQL Server from the Query Playground. Each driver (`pg`, `mysql2`, `better-sqlite3`, `mssql`) is an optional peer dependency and is dynamically imported only when needed. New endpoints: `GET /api/execute/status` (returns the configured provider, driver package name, installed status, and install command without ever throwing for a missing driver) and `POST /api/execute/install-driver` (loopback-only; detects the project package manager from the nearest lockfile; installs only the allowlisted package for the configured provider). The Execute button in the Playground shows a compact status row with the provider label, connection/file status, driver readiness, an Install button when the driver is missing (local Studio only), or a manual install command. All four driver packages are added as dev dependencies for local development and CI type-checking; only the driver for the configured dialect needs to be installed by the application at runtime.

## 1.0.0-beta.8

### Minor Changes

- d4a0a1d: Add Anthropic Claude as a supported AI provider, open the config provider union for custom adapters, and make the key-missing message registry-driven.

  **New package: `@askdb/ai-anthropic`** — Set `ASKDB_AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Anthropic Claude models. The default model is `claude-sonnet-4-6`; override with `ASKDB_AI_MODEL` or `ANTHROPIC_MODEL`. The `anthropic` provider is also configurable via `askdb.config.*` using the new `providerConfig.anthropic` branch (`apiKey`, `model`, `baseUrl`). Anthropic has no embeddings API; `createEmbeddingModel` throws a clear error directing you to configure a separate embedding provider.

  **Registry-driven key-missing message (`@askdb/ai`)** — `AiProviderAdapter` gains an optional `configHint` field. `AiRegistry` gains `keyMissingMessage(context)` that assembles hints from all registered adapters (deduplicated across aliases, stable registration order). The static `aiKeyMissingMessage` export is deprecated in favor of `ai.keyMissingMessage(context)`. All four surfaces (CLI, HTTP API, Studio, TUI) now use the registry method so Anthropic (and any future adapter) is automatically mentioned.

  **Custom provider config branch (`@askdb/config`)** — `AskDbAiConfig` now accepts any provider string, not just the four known literals. Known literals still get dedicated branches with required `providerConfig`; any other string falls through to the new `CustomAiConfig` branch, which flattens to the universal `ASKDB_AI_*` env keys. Custom providers only work end to end when the host registry contains an adapter registered under that provider name — the first-party apps register only first-party adapters.

### Patch Changes

- c0603e1: Resolve the runtime introspection output directory through `@askdb/config` and use it when **`askdb ask`** omits **`--schema`**. Pass **`--schema <path>`** to override.
- 0f0c481: Throw a clear `askdb.config:` error when a first-party provider (`openai`/`azure`/`foundry`/`google`/`anthropic`) is selected without its `providerConfig` branch, instead of crashing with a TypeError during config flattening.

## 1.0.0-beta.7

### Patch Changes

- 05a589a: Fix Studio execute endpoint not reading `databaseUrl` from `askdb.config.*`.

  `POST /api/execute` was reading `ASKDB_STUDIO_DATABASE_URL` directly from `process.env`, which is never populated because `bootstrapAskDbEnv` intentionally does not mutate `process.env`. The studio now reads `studio.execute.databaseUrl` via `getAskDbRuntimeConfig()`.

  `@askdb/config` gains `AskDbRuntimeStudioConfig` (exported) and a `studio` field on `AskDbRuntimeConfig`, making the studio database URL available through the typed runtime config accessor.

## 1.0.0-beta.6

### Major Changes

- 1eacf3f: Remove `database` config section; move connection URLs into `introspection` and `studio`.

  **Breaking:** `AskDbConfig.database` is removed. Move the Postgres connection URL from `database.providerConfig.postgres.databaseUrl` into `introspection.providerConfig.postgres.databaseUrl` (maps to `ASKDB_INTROSPECT_POSTGRES_URL`). The generic `DATABASE_URL` flat key is no longer set by `flattenAskDbConfig`.

  **Breaking:** Studio query execution (`POST /api/execute`) now reads `ASKDB_STUDIO_DATABASE_URL` instead of `DATABASE_URL`. Set `studio.execute.databaseUrl` in `askdb.config.*` (maps to `ASKDB_STUDIO_DATABASE_URL`).

  `AskDbRuntimeIntrospectionConfig` gains a new `postgresDatabaseUrl` field. The `DATABASE_URL` fallback for MySQL and SQL Server introspection is removed; configure those URLs explicitly via `introspection.providerConfig.<engine>.databaseUrl` or `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLSERVER_URL`.

## 0.3.0-beta.5

### Patch Changes

- 5ceadc8: Allow multiple introspection provider configs in `providerConfig` simultaneously.

  Introduces `IntrospectionProviderConfigs` with all five provider keys (`postgres`, `prisma`, `mysql`, `sqlite`, `sqlserver`) as optional fields. Each `*IntrospectionConfig` branch now accepts the full set instead of only its own key, matching the same pattern already applied to the AI provider config.

- 5ceadc8: Allow multiple provider configs in `providerConfig` simultaneously.

  `providerConfig` now accepts configs for all providers as optional fields, while still requiring the one matching `provider`. This lets a single config object hold credentials for multiple providers and switch between them by changing only the `provider` field.

## 0.3.0-beta.4

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

## 0.3.0-beta.3

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

## 0.3.0-beta.2

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

- 57db375: **Discriminated union types for `ai` and `introspection` in `AskDbConfig`** — each `provider` value now enforces exactly the right `providerConfig` branch at compile time (e.g. `provider: "openai"` requires `providerConfig: { openai: OpenaiConfig }` and rejects any other key). Named branch types are exported: `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `AskDbAiConfig`, `PostgresIntrospectionConfig`, `PrismaIntrospectionConfig`, `AskDbIntrospectionConfig`.

  **Prisma schema auto-discovery in `@askdb/prisma`** — `discoverPrismaSchemaPath()` is now exported and probes `prisma/schema.prisma`, `schema.prisma`, and `prisma/` (multi-file) in order. Setting `introspection.provider: "prisma"` is now sufficient without an explicit `schemaPath`; the path can still be set via `introspection.providerConfig.prisma.schemaPath` to override discovery.

  **`ASKDB_PRISMA_SCHEMA` env var removed** — the Prisma schema path is read from the bootstrapped structured config (`getAskDbRuntimeConfig().introspection.prismaSchemaPath`) instead of a flat env key. `AskDbRuntimeConfig` gains a typed `introspection` field with `provider`, `prismaSchemaPath`, and `outputDir`.

  **`RUNTIME_SHELL_FLAT_OVERRIDES` removed from bootstrap** — `askdb.config.*` is now the sole source of truth; use `env("VAR")` inside the config file to read from shell or `.env` at load time.

### Patch Changes

- eb325a2: **Dialect-agnostic SQL pipeline moved from `@askdb/postgres` to `@askdb/core`** — `generateSelectSql`, `validateSelectSql`, `buildNlToSqlUserPrompt`, `buildNlToSqlSystemPrompt`, `assertNlToSqlInputs`, and `nlToSqlAmbiguityNotes` are now exported from `@askdb/core` and parameterized by a `DialectSpec`.

  **New `DialectSpec` / `DialectId` types in `@askdb/core`** — `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `BUILT_IN_DIALECTS`, `SUPPORTED_DIALECT_IDS`, `isBuiltInDialectId`, and `getDialectSpec` are exported from `@askdb/core/sql/dialect-spec`, enabling other dialects to plug in without touching `@askdb/postgres`.

  **`@askdb/postgres` re-exports for backwards compatibility** — `postgresDialect` and `PostgresDialect` are re-exported from `@askdb/core` so existing callers continue to work. The NL→SQL SQL logic has been removed from `@askdb/postgres`.

- a4f14f7: **`MYSQL_DIALECT`, `MARIADB_DIALECT`, `SQLITE_DIALECT`, and `SQLSERVER_DIALECT` ship in `@askdb/core`.** All four are registered in `BUILT_IN_DIALECTS` and exported from `@askdb/core`; `ASKDB_DIALECTS` in `@askdb/config` is expanded accordingly so `askdb.config.dialect` autocompletes for every shipped spec.

  **Auto-selection now covers every Prisma provider.** A Prisma user pointed at `mysql`, `sqlite`, or `sqlserver` no longer gets the "AskDB does not yet ship a DialectSpec" error — `askdb introspect` writes the detected provider into `schema.json`, and `askdb ask` (and the HTTP API / Studio) auto-picks the matching dialect.

  **Prompt briefs.** Each spec carries a one-paragraph syntax brief covering quoting, casting, date/time helpers, string concat, and row-limit clauses. Examples: MySQL prompts for `CONCAT()` (since `||` is logical OR), SQL Server for `TOP n` / `OFFSET … FETCH NEXT` (no `LIMIT`), SQLite for `strftime()` and dynamic typing. `SELECT *`-style read-only shape checks (single statement, no comments, no DDL/DML keywords) remain centralized; per-dialect denylists add `ATTACH`/`DETACH`/`PRAGMA`/`REINDEX` (SQLite) and `EXEC`/`MERGE`/`OPENROWSET` (SQL Server).

## 0.3.0-beta.1

### Patch Changes

- 06e5f54: **Breaking for npm consumers:** the CLI is published as the unscoped package **`askdb`** (was `@askdb/cli`). Update `package.json` dependencies and install commands accordingly (`npm i askdb`, `npx askdb init`, etc.). The `askdb` binary name is unchanged.

  Also updates a `@askdb/config` bootstrap doc comment that referenced the old package name, plus README cross-links in `@askdb/introspect` and `@askdb/tui`.

## 0.3.0-beta.0

### Minor Changes

- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

### Patch Changes

- 25980e4: Centralize optional `askdb.config` defaults in `flattenAskDbConfig` instead of `optionalEnv`. `env()` now returns `undefined` when unset; add `requiredEnv` for fail-fast reads. Introduce `defaults.ts`, align the default RAG file-store path with `./askdb/rag`, and emit `ASKDB_PGVECTOR_INDEX_STRATEGY` when flattening pgvector. Refresh the `askdb init` template, root `askdb.config.ts`, and documentation.
