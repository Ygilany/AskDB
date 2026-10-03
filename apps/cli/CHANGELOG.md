# askdb

## 1.0.0-beta.44

### Minor Changes

- c6e289a: The OpenAI, Azure OpenAI / Foundry, Google, and Anthropic providers are now built into `@askdb/ai`. The `@askdb/ai-*` packages are deprecated (ADR 0006 amendment, Option E).
  
  **@askdb/ai**: ships the four providers (moved unchanged from `@askdb/ai-*`) plus a new zero-dependency `gateway` provider for the Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model ids like `openai/gpt-4o-mini`). Each provider loads its AI SDK package lazily, the first time it builds a model. `@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`, and `@ai-sdk/anthropic` are now **optional peer dependencies**: install the one for the provider you configure. If it's missing, model creation fails with `Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`. The peer ranges are `^4.0.0` (the contract tests pass against 4.0.0), so a host on an older 4.x SDK isn't forced to upgrade. The lazy imports are written so esbuild builds without the SDKs a host didn't install. webpack 5 doesn't: see the webpack note under the deprecated packages below.
  
  - `createAiRegistry()` with no arguments registers every built-in provider. It also accepts built-in names and aliases (`createAiRegistry(["openai"])`), mixed freely with `AiProviderAdapter` objects. Custom adapters work unchanged.
  - New exports: `BUILTIN_AI_PROVIDERS` (one table of names, aliases, env vars, default models, and SDK packages), `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`, the adapters `openaiProvider` / `azureProvider` / `googleProvider` / `anthropicProvider` / `gatewayProvider`, and the `AiProviderSelector` type.
  - `aiProviderMissingMessage` now says to pass the built-in name to `createAiRegistry()` and to install `@ai-sdk/<provider>`, instead of naming an `@askdb/ai-*` package. `aiKeyMissingMessage` also lists the gateway.
  - The `gateway` provider maps reasoning effort through its upstream (`openai/`, `google/`, `anthropic/` model ids), sends embedding `dimensions` for `openai/` and `google/` models and refuses them for other upstreams, and rejects model ids without an `<upstream>/` prefix.
  - The `openai` provider now also sends `forceReasoning: true` with a reasoning effort, so an `@ai-sdk/openai` release that predates a model family (gpt-6 before 4.0.60) still sends it.
  - The built-in adapters' `createLanguageModel` / `createEmbeddingModel` are now `async`. The `AiProviderAdapter` contract already allowed promises, and `AiRegistry` methods were already async.
  
  **@askdb/ai-openai, @askdb/ai-azure, @askdb/ai-google, @askdb/ai-anthropic (deprecated)**: each now only re-exports its adapter from `@askdb/ai`, which it depends on directly (it was a peer). It keeps its `@ai-sdk/*` dependency, so existing installs and imports keep working, except in a webpack bundle. These packages will be removed before 1.0 (#347).
  
  **webpack users, including shim users who change nothing:** importing `@askdb/client`, `@askdb/ai`, or a shim now reaches every built-in provider's `import("@ai-sdk/<x>")`, and webpack 5 fails with `Module not found: Error: Can't resolve '@ai-sdk/google'` (and the other SDKs you don't have). Before this release, `@askdb/client` + `@askdb/ai-openai` bundled without the other SDKs. Install all four `@ai-sdk/*` packages, or mark the ones you don't use as `externals` (with ESM output, use `externalsType: "module"` and the bare package names):
  
  ```js
  // webpack.config.js: list the @ai-sdk/* packages you don't install.
  module.exports = {
    // ...
    externals: {
      "@ai-sdk/anthropic": "commonjs @ai-sdk/anthropic",
      "@ai-sdk/azure": "commonjs @ai-sdk/azure",
      "@ai-sdk/google": "commonjs @ai-sdk/google",
    },
  };
  ```
  
  A provider whose SDK isn't installed then fails at runtime with the install message. esbuild needs no change.
  
  To migrate:
  
  ```diff
  - npm i @askdb/ai-openai
  + npm i @askdb/ai @ai-sdk/openai
  
  - import { openaiProvider } from "@askdb/ai-openai";
  - const askdb = createAskDb({ config, providers: [openaiProvider] });
  + const askdb = createAskDb({ config }); // or providers: ["openai"]
  
  - const ai = createAiRegistry([openaiProvider]);
  + const ai = createAiRegistry(["openai"]);
  ```
  
  **@askdb/client**: `createAskDb({ config })` no longer throws when neither `providers` nor `registry` is passed. It registers every built-in `@askdb/ai` provider, and `ai.provider` in the config picks one. `providers` also accepts built-in names. The four `@ai-sdk/*` packages are declared as optional peers (`^4.0.0`) so strict installs such as Yarn Plug'n'Play pass the host's SDK through to `@askdb/ai`.
  
  **@askdb/config**: new `ai.provider: "gateway"` branch (`providerConfig.gateway.{apiKey, baseUrl, model}`, flattened to `AI_GATEWAY_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL`). `ASKDB_AI_PROVIDERS` includes `"gateway"`. `DEFAULT_ANTHROPIC_CHAT_MODEL`, `DEFAULT_GOOGLE_CHAT_MODEL`, and `DEFAULT_GATEWAY_CHAT_MODEL` are now exported. A test in `@askdb/client` (which depends on both) fails if this list, these defaults, or the env var names `flatten` writes drift from the built-in provider table. `askdb init` and Studio's setup wizard take each provider's default API key and model env var names from `@askdb/ai`'s provider table instead of keeping their own copies.
  
  **askdb, @askdb/http-api, @askdb/studio**: register providers with `createAiRegistry()` and depend on `@askdb/ai` plus all four `@ai-sdk/*` packages instead of `@askdb/ai-*`. They still work from env/config alone. `askdb init` and Studio setup now take their provider choices and scaffolded env var names from `@askdb/ai`'s table, and both offer the Vercel AI Gateway. Google now scaffolds `GOOGLE_AI_MODEL`, the variable the provider actually reads, instead of `GOOGLE_GENERATIVE_AI_MODEL`. Studio's "Get the code" snippet uses `@askdb/client` + `@ai-sdk/<provider>`. `askdb help init` lists every `--ai-provider` value, including `gateway`.
  
  **@askdb/rag**: the deprecation note on `createOpenAiEmbedder` now points at `createAiRegistry(["openai"])` instead of the `@askdb/ai-openai` adapter.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.

### Patch Changes

- e57c734: Fix AI adapter correctness bugs that the AI SDK silently ignored.
  
  **@askdb/ai-azure**: Embedding `dimensions`/`user` are now sent. They were wrapped under `providerOptions.azure`, but `@ai-sdk/azure` builds embeddings with `OpenAIEmbeddingModel`, which reads only `providerOptions.openai`, so they were dropped. `reasoningEffort` now also sets `forceReasoning: true`. The AI SDK decides whether a model can reason from the model id it was given, which on Azure is the deployment name. Without this flag, a deployment such as `askdb-reporting` backed by `modelFamily: "gpt-5"` silently lost its reasoning effort. The missing-resource error now names the config keys (`ai.providerConfig.azure.resourceName` / `baseUrl`) and gives the `AZURE_RESOURCE_NAME` env alternative.
  
  **@askdb/ai-google**: Embeddings use the non-deprecated `google.embedding()` and now honor `dimensions`, mapped to Gemini's `outputDimensionality`.
  
  **@askdb/ai-openai / @askdb/ai-azure**: Reasoning-model detection no longer treats `gpt-5-chat*` (non-reasoning chat models) as reasoning models. It now recognizes gpt-5 point releases and later majors (`gpt-5.1`, `gpt-6`, …). gpt-6 and later accept `low` through `max` but not `minimal`, so a `minimal` effort is sent as `low` for them. This covers Azure deployments with a custom name and `modelFamily: "gpt-6"`, where the SDK can't see the family and would otherwise send `minimal`.
  
  **@askdb/ai-anthropic**: Reasoning-model detection now follows `@ai-sdk/anthropic`'s capability table. Claude Sonnet 4.6, Opus 4.6+, and the 5.x models (Opus 5, Sonnet 5, Fable 5, …) get adaptive thinking (`thinking: { type: "adaptive" }` plus `effort`) instead of the manual `budgetTokens` form, which newer models reject. Claude Haiku 4.5 now gets extended thinking.
  
  **@askdb/ai**: `aiKeyMissingMessage` now lists Anthropic. `aiProviderMissingMessage` maps aliases to the package that owns them (for example, `foundry` points to `@askdb/ai-azure`). It no longer suggests a nonexistent `@askdb/ai-<name>` package for custom providers. `withEmbeddingProviderOptions` takes an optional fourth argument that maps the portable `dimensions`/`user` options to a provider's own setting names; `@askdb/ai-google` now uses it instead of its own wrapper.
  
  **@askdb/config**: `AzureConfig` / `FoundryConfig` gain `resourceName`, which is flattened to the key the Azure adapter reads. Before this, a config-only Azure setup couldn't supply a resource name and failed at startup. `ASKDB_AI_PROVIDERS` now includes `"anthropic"`. New `@askdb/config/scaffold` entry point for tools that write a new `askdb.config.ts`: `renderAskDbAiConfigScaffold` renders its `ai` block and lists the env vars it reads, and `askdb init` and Studio's setup wizard both use it. The main entry is unchanged apart from `resourceName` and `ASKDB_AI_PROVIDERS`.
  
  **askdb / @askdb/studio**: `askdb init --ai-provider azure|foundry` and Studio's setup wizard (Azure OpenAI or Foundry) scaffold `resourceName: env("AZURE_RESOURCE_NAME")` and list `AZURE_RESOURCE_NAME` in `.env.example`, so the generated config works out of the box. `askdb init`'s `.env.example` now puts a one-line comment above each AI variable, and lists the SQLite file variable (`SQLITE_FILE` or the `--sqlite-file` env name) when the config reads one. It now also lists `DATABASE_URL` for `--database prisma --studio-execute` and `ASKDB_PGVECTOR_URL` for `--rag-store pgvector` without `--pgvector-env`, both of which the config read but `.env.example` left out, and lists each variable once. `--sqlite-file` now treats only an env-name-shaped value (`UPPER_SNAKE_CASE`) as a variable; a relative path such as `data.db` or `../db/app.db` is written as a literal path instead of `env("data.db")`.
- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- c610168: **CLI: `--help` / `--version` work without a config; friendly missing-config error.**
  
  - `askdb` no longer loads `askdb.config.*` before parsing arguments, so `askdb --help`, `-h`, `--version`, `-V`, `help`, no-args, `init`, `bundle`, `introspect --help`, and `introspect templates` all work in a directory without a config. Commands that read config (`ask`, `introspect`) load it lazily.
  - `askdb --version` / `-V` is now supported and prints the package version.
  - When a command needs config and none exists, the CLI prints `No askdb.config.* or .config/askdb.* found in <cwd>. Run \`npx askdb init\` to create one.` and exits 1, with no stack trace. Other uncaught errors (for example a config that fails to load) print their message and a hint; set `ASKDB_DEBUG=1` (or `true`) to include the stack trace. Other values, including `0`, and the `debug` package's `DEBUG` variable leave it off.
  - `askdb studio` / `askdb enrich` warn when `askdb.config.*` exists but fails to load, instead of ignoring it silently.
  
  **Docs:** the `@askdb/core` README states the pre-release beta status accurately.
- Updated dependencies [e57c734]
- Updated dependencies [e7ea657]
- Updated dependencies [f506c14]
- Updated dependencies [c610168]
- Updated dependencies [c6e289a]
- Updated dependencies [0009bb1]
- Updated dependencies [9847a87]
- Updated dependencies [9021e54]
  - @askdb/ai@0.1.0-beta.8
  - @askdb/config@1.0.0-beta.13
  - @askdb/studio@0.2.0-beta.37
  - @askdb/core@1.0.0-beta.44
  - @askdb/client@1.0.0-beta.7
  - @askdb/connectors@0.1.0-beta.9
  - @askdb/enrich@0.2.0-beta.15
  - @askdb/introspect@0.3.0-beta.18
  - @askdb/mysql@0.1.0-beta.19
  - @askdb/postgres@0.2.0-beta.20
  - @askdb/prisma@0.2.0-beta.18
  - @askdb/sqlite@0.1.0-beta.19
  - @askdb/sqlserver@0.1.0-beta.20

## 1.0.0-beta.43

### Minor Changes

- 5dbe2d6: **MySQL/MariaDB: introspect several databases at once.**

  **@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

  **@askdb/config**: New `introspection.schemas?: string[]`, the config equivalent of `askdb introspect --schemas`, for every provider (on MySQL/MariaDB, the databases to introspect). Runtime config exposes it as `introspection.schemas`.

  **askdb**: `askdb introspect` reads `introspection.schemas` from config for any engine; `--schemas` overrides it.

  **@askdb/studio**: Resync passes the configured schema list to the connector, so it matches `askdb introspect`.

- cc176d1: Breaking (pre-1.0, so a minor bump):

  - Require Node `>=22.12` consistently: `askdb`, `@askdb/http-api`, and `@askdb/studio` previously declared `>=22`, but the libraries they depend on already required `>=22.12`.
  - `@askdb/http-api` and `@askdb/studio` now declare an `exports` map: `.` (the package entry) and `./package.json`. Deep imports of other files, such as `@askdb/studio/dist/server.js`, are no longer allowed; import from the package entry instead.

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 5e89384: **@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) now opens by calling the check a best-effort lint, and says it is not a SQL parser and not a security boundary, with real tenant isolation coming from the database, and that `global` scope skips it. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

  **@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

  **askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.

- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

- 933bd6c: **@askdb/studio** (security): Playground execute is now opt-in, runs one read-only statement at a time, and has a timeout and a row cap.

  - **Off by default.** `POST /api/execute` returns `403` with setup instructions until `studio.execute.enabled: true` is set. The Playground hides the Execute button and shows why. `/api/execute/status` now reports `enabled`, `disabledReason`, `timeoutMs`, and `maxRows`.
  - **No silent credential reuse.** Execute no longer falls back to the introspection connection. Set `studio.execute.databaseUrl` / `file`, ideally for a read-only role, or opt in with `studio.execute.useIntrospectionConnection: true`. This is a breaking change for projects that relied on the fallback.
  - **Validated before execution.** Every query must pass `@askdb/core`'s `validateSelectSql` for the execute engine's dialect. Otherwise the request fails with `400` and never reaches the driver. SQL that reads `sensitive` columns returns `warnings`.
  - **One read-only statement.** Postgres forces the extended query protocol, so `SELECT 1; COMMIT; DROP …` can no longer escape `BEGIN READ ONLY`, and turns on `default_transaction_read_only`. MySQL and MariaDB use a prepared statement in `START TRANSACTION READ ONLY`. SQL Server runs inside `SET XACT_ABORT ON; BEGIN TRANSACTION … ROLLBACK`. SQL Server has no read-only mode, so use a read-only login.
  - **Timeouts and row caps.** Queries time out after 30 s by default (`studio.execute.timeoutMs`; not enforced for SQLite). Studio fetches at most `studio.execute.maxRows + 1` rows (default 500) and reports `truncated` and `rowLimit`, instead of loading every row and slicing.
  - **Bounded requests.** JSON bodies over 1 MiB return `413`. Playground history keeps only known fields with length limits. Studio adds `playground-history.json` to the schema directory's `.gitignore`, creating the file with `.env` rules if it doesn't exist.
  - **Driver install.** Inherited keys such as `constructor` are rejected with `400`, and installs now work on Windows. The setup wizard and install endpoint share one package-manager spawn helper.
  - The setup wizard now defaults Studio execute to off, and choosing it writes `enabled: true`.

  **@askdb/config**: New `studio.execute` fields, each with a canonical flat key: `enabled` (`ASKDB_STUDIO_EXECUTE_ENABLED`, default `false`), `useIntrospectionConnection` (`ASKDB_STUDIO_EXECUTE_USE_INTROSPECTION_CONNECTION`, default `false`), `timeoutMs` (`ASKDB_STUDIO_EXECUTE_TIMEOUT_MS`, default `30000`), and `maxRows` (`ASKDB_STUDIO_EXECUTE_MAX_ROWS`, default `500`). The runtime `studio.execute.databaseUrl` / `file` no longer fall back to the introspection connection unless `useIntrospectionConnection` is `true`. Also exports `DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS` and `DEFAULT_STUDIO_EXECUTE_MAX_ROWS`.

  **askdb**: `askdb init` writes `enabled: true` in the `studio.execute` block when you choose Studio execute. The interactive wizard now defaults that choice to off, matching `--studio-execute`'s documented default.

- 2a21161: **@askdb/studio** (security): The local API now rejects requests from other websites in your browser, closing a cross-site request and DNS-rebinding hole that let any open web page run SQL through `/api/execute` or rewrite schema files.

  - Every request must send an allowed `Host`: `localhost`, `127.0.0.1`, `[::1]`, or the bound host (for `0.0.0.0` binds, this machine's own IP addresses), on Studio's own port.
  - Every `/api/*` call must send the per-launch session token that Studio injects into the page it serves, as the `x-askdb-studio-token` header.
  - State-changing calls must be same-origin, and requests with a body must use `Content-Type: application/json`.

  The web app now shows the HTTP status instead of a JSON parse error when a failed API request returns a non-JSON body (a proxy error page or an empty 502); server-provided error messages are still shown as before. Binding to a non-loopback host now prints a startup warning. `createStudioServer()` returns the token as `server.sessionToken` for programmatic callers. This is a breaking change for any client that called the API without it. The setup wizard's `askdb.config.ts` writer now emits every value with `JSON.stringify`, rejects control characters in paths, and validates the execute provider. Previously, a crafted path could inject code that ran when Studio loaded the config.

  **askdb**: `askdb init` escapes every value it writes into `askdb.config.ts` the same way, so quotes or backslashes in `--schema-out`, `--sqlite-file`, `--prisma-schema`, or env-name flags can no longer break out of their string literals.

- Updated dependencies [1338535]
- Updated dependencies [70a9513]
- Updated dependencies [ad9c9e5]
- Updated dependencies [1338535]
- Updated dependencies [764ec32]
- Updated dependencies [ab2150b]
- Updated dependencies [5e89384]
- Updated dependencies [5dbe2d6]
- Updated dependencies [cc176d1]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [2a21161]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/studio@0.2.0-beta.36
  - @askdb/enrich@0.2.0-beta.14
  - @askdb/ai-anthropic@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.7
  - @askdb/ai-google@1.0.0-beta.7
  - @askdb/ai-openai@1.0.0-beta.7
  - @askdb/ai@0.1.0-beta.7
  - @askdb/client@1.0.0-beta.6
  - @askdb/config@1.0.0-beta.12
  - @askdb/connectors@0.1.0-beta.8
  - @askdb/introspect@0.3.0-beta.17
  - @askdb/mysql@0.1.0-beta.18
  - @askdb/postgres@0.2.0-beta.19
  - @askdb/prisma@0.2.0-beta.17
  - @askdb/sqlite@0.1.0-beta.18
  - @askdb/sqlserver@0.1.0-beta.19

## 1.0.0-beta.42

### Patch Changes

- 1af6263: **@askdb/core**: promote the sensitive-identifier SQL check out of the CLI into core as a public, enforceable API, and fix its false-positive problem.

  New export `validateSensitiveReferences(sql, schema, options?)` reports the `sensitive` tables and columns a SQL statement references, returning `{ passed, references, unresolvedScope? }` — the same shape as `TenantGuardrailResult`. Each reference carries `matchKind: "qualified" | "unqualified" | "table"`. `{ mode: "strict" }` throws the new `SensitiveReferenceError extends AskDbError` with a `SensitiveReferenceRuleCode`; `{ mode: "warn" }` (the default) returns without throwing.

  `sensitive: true` was previously prompt-level only — `formatSchemaForNlToSql` tags or withholds identifiers, which constrains what the model _sees_ but not SQL that reaches execution by another route (a host SQL cache, a replayed statement, a regenerated artifact). `validateSensitiveReferences` is the enforcement path and is exported standalone so it can run on stored SQL with no model in the loop.

  **Fixes the unqualified matcher.** The CLI's private implementation regex-tested each sensitive column name anywhere in the statement, so any table-level-`sensitive` table with a common column (`id`, `name`, `tag`) flagged every benign query. Unqualified names now count only when the owning table is actually in the statement's scope: `FROM`/`JOIN` targets and their aliases are resolved first, including inside CTEs and derived tables, and string literals and comments are excluded. When scope cannot be proven the check fails conservatively and says why via `unresolvedScope`, mirroring how `validateTenantGuardrails` handles unprovable scope.

  `ask()` runs the guardrail over the SQL it returns and attaches `AskPipelineResult.sensitiveGuardrail`; the new `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default — not a breaking change), `"strict"`, or `"off"`. Reuses the existing `askdb.pipeline.sensitive_sql_warning` log event, now exposed as `AskDbLogEvent.PipelineSensitiveSqlWarning`. Also exports `schemaHasSensitiveIdentifiers` and `formatSensitiveReference`.

  **askdb**: `askdb ask` now renders the guardrail result from `ask()` instead of its own private copy of the check, so there is one implementation. The warning no longer fires on unrelated queries that merely share a column name with a sensitive table, and schema-qualified schemas now print `schema.table.column`. Unresolvable statement scope is surfaced as a `Note:` line.

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
- Updated dependencies [5781271]
  - @askdb/core@1.0.0-beta.42
  - @askdb/ai@0.1.0-beta.6
  - @askdb/ai-anthropic@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.6
  - @askdb/ai-google@1.0.0-beta.6
  - @askdb/ai-openai@1.0.0-beta.6
  - @askdb/client@1.0.0-beta.5
  - @askdb/config@1.0.0-beta.11
  - @askdb/connectors@0.1.0-beta.7
  - @askdb/enrich@0.2.0-beta.13
  - @askdb/introspect@0.3.0-beta.16
  - @askdb/mysql@0.1.0-beta.17
  - @askdb/postgres@0.2.0-beta.18
  - @askdb/prisma@0.2.0-beta.16
  - @askdb/sqlite@0.1.0-beta.17
  - @askdb/sqlserver@0.1.0-beta.18
  - @askdb/studio@0.2.0-beta.35

## 1.0.0-beta.41

### Minor Changes

- 0c62b25: Upgrade the Vercel AI SDK integration to AI SDK 7.

  This moves `ai` to `^7.0.51` and the first-party provider packages to their AI SDK 7-compatible majors:

  - `@ai-sdk/openai` `^4.0.29`
  - `@ai-sdk/anthropic` `^4.0.29`
  - `@ai-sdk/google` `^4.0.33`
  - `@ai-sdk/azure` `^4.0.30`

  AI SDK 7 requires Node.js 22 or newer, so AskDB packages that expose or carry the AI SDK runtime now advertise `node >=22`. Core model calls now use the AI SDK 7 `instructions` option, and the Google adapter uses the renamed `createGoogle` provider factory.

### Patch Changes

- Updated dependencies [0c44b76]
- Updated dependencies [0c62b25]
  - @askdb/ai@0.1.0-beta.5
  - @askdb/ai-openai@1.0.0-beta.5
  - @askdb/ai-google@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.5
  - @askdb/ai-anthropic@1.0.0-beta.3
  - @askdb/core@1.0.0-beta.41
  - @askdb/config@1.0.0-beta.10
  - @askdb/client@1.0.0-beta.4
  - @askdb/studio@0.2.0-beta.34
  - @askdb/enrich@0.2.0-beta.12
  - @askdb/introspect@0.3.0-beta.15
  - @askdb/mysql@0.1.0-beta.16
  - @askdb/postgres@0.2.0-beta.17
  - @askdb/sqlite@0.1.0-beta.16
  - @askdb/sqlserver@0.1.0-beta.17
  - @askdb/connectors@0.1.0-beta.6
  - @askdb/prisma@0.2.0-beta.15

## 1.0.0-beta.40

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/studio@0.2.0-beta.33
  - @askdb/client@1.0.0-beta.3
  - @askdb/enrich@0.2.0-beta.11
  - @askdb/introspect@0.3.0-beta.14
  - @askdb/mysql@0.1.0-beta.15
  - @askdb/postgres@0.2.0-beta.16
  - @askdb/sqlite@0.1.0-beta.15
  - @askdb/sqlserver@0.1.0-beta.16
  - @askdb/connectors@0.1.0-beta.5
  - @askdb/prisma@0.2.0-beta.14

## 1.0.0-beta.39

### Patch Changes

- 84069cf: Drop dotenv from generated config; use DATABASE_URL universally; generate .env.example with placeholder connection strings.

  `askdb init` and the Studio setup wizard no longer emit `import dotenv` or install `dotenv` explicitly — `bootstrapAskDbEnv()` already loads `.env` before evaluating the config file, and `dotenv` is already a transitive dependency of `@askdb/config`.

  All network database providers (postgres, mysql, sqlserver) now default to `DATABASE_URL` instead of provider-specific names like `MYSQL_URL` or `SQLSERVER_URL`.

  Both `askdb init` and the Studio wizard now generate a `.env.example` alongside `askdb.config.ts`, pre-populated with a ready-to-copy placeholder connection string in the correct format for the selected database (postgresql:// URI, mysql:// URI, or MSSQL ADO.NET connection string).

- Updated dependencies [84069cf]
  - @askdb/studio@0.2.0-beta.32

## 1.0.0-beta.38

### Patch Changes

- 5acd920: **@askdb/studio**: the guided setup wizard reaches parity with `askdb init` — it now also asks for the AI model env var, RAG store (file/memory/pgvector), Studio execute config, and supports the Azure AI Foundry provider. Env var _name_ fields (connection URL, AI key, AI model, pgvector, Studio execute connection) render as a pre-filled default and only become editable when clicked, instead of always showing an open text input. Fixes a bug where writing a config with `ragStore: "pgvector"` before `.env` was filled in returned a 500.

  **askdb**: `askdb init`'s interactive wizard no longer prompts you to name env vars — it uses conventional defaults (`DATABASE_URL`, `OPENAI_API_KEY`, ...) and tells you in the summary/next-steps output that you can rename any `env("...")` call in the generated `askdb.config.ts` afterward.

- Updated dependencies [5acd920]
  - @askdb/studio@0.2.0-beta.31

## 1.0.0-beta.37

### Minor Changes

- 857fd50: Retire the `@askdb/tui` terminal authoring surface in favor of Studio.

  Studio (`askdb studio`) is a strict superset of the TUI for Schema v2
  enrichment and has been the documented authoring surface since the
  studio-first onboarding work. The `@askdb/tui` package is removed from the
  workspace:

  - `askdb enrich` now opens Studio (prints a one-line retirement notice and
    forwards arguments such as `--schema`).
  - `askdb bundle <dir> --out <file>` now calls `@askdb/enrich` directly; the
    command was always headless and no longer routes through a UI package.
  - The `askdb-tui` binary is no longer published.

  All shared authoring logic (workspace loading, drafts, frontmatter
  round-tripping, bundling, suggestion targets) already lives in
  `@askdb/enrich`, so no enrichment behavior changes.

## 1.0.0-beta.36

### Patch Changes

- Updated dependencies [7311ac5]
- Updated dependencies [fa690a3]
- Updated dependencies [162c33b]
- Updated dependencies [b7f70b6]
- Updated dependencies [56920c8]
- Updated dependencies [7311ac5]
  - @askdb/client@1.0.0-beta.3
  - @askdb/studio@0.2.0-beta.30
  - @askdb/ai@0.1.0-beta.4
  - @askdb/ai-openai@1.0.0-beta.4
  - @askdb/ai-anthropic@1.0.0-beta.2
  - @askdb/ai-google@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.4
  - @askdb/core@1.0.0-beta.36
  - @askdb/tui@0.2.0-beta.17
  - @askdb/introspect@0.3.0-beta.13
  - @askdb/mysql@0.1.0-beta.14
  - @askdb/postgres@0.2.0-beta.15
  - @askdb/sqlite@0.1.0-beta.14
  - @askdb/sqlserver@0.1.0-beta.15
  - @askdb/connectors@0.1.0-beta.4
  - @askdb/prisma@0.2.0-beta.13

## 1.0.0-beta.35

### Patch Changes

- 45fef02: **@askdb/studio**: Studio is now a viable front door for a brand-new project.

  - **Guided setup wizard.** `askdb studio` (or `askdb-studio`) in a directory with no `askdb.config.*` or no schema artifact no longer errors out — Studio starts in setup mode and the browser walks you through it: pick a database engine and AI provider (env var _names_ only — secret values stay in `.env`, which the wizard tells you to create), Studio writes `askdb.config.ts` and `.env.example`, then runs introspection server-side and opens the Overview. New endpoints: `GET /api/setup/status`, `POST /api/setup/config`, `POST /api/setup/introspect` (config write and introspection are loopback-only). Passing an explicit `--schema` that doesn't exist still fails fast.
  - **"Resync schema" now works.** The Overview button (previously a no-op) re-runs introspection server-side using the connection from `askdb.config.ts` — same engine resolution as `askdb introspect` with no flags — and reloads the workspace. Enrichment markdown is preserved, exactly like the CLI path. New endpoints: `GET /api/introspect/status` (plan preview with credential-redacted source), `POST /api/introspect` (loopback-only).
  - **"Get the code" panel in the Playground.** Below the generated SQL, Studio renders the exact integration snippet for the current workspace — your question, schema path, resolved dialect, configured provider, and (when enabled) the tenant scope — in two styles: config-driven `createAskDb()` from `@askdb/client`, or direct `ask()` from `@askdb/core`. Copy-paste it into a Node service and it runs against the same config Studio uses.
  - `StudioWorkspaceDto` gains `dialect` and `schemaPathRelative`.

  **askdb**: `askdb studio` no longer aborts when no `askdb.config.*` exists — it starts Studio in setup mode so the browser wizard can scaffold the project. All other commands still require a config.

- Updated dependencies [45fef02]
  - @askdb/studio@0.2.0-beta.29

## 1.0.0-beta.34

### Patch Changes

- Updated dependencies [a30643a]
  - @askdb/studio@0.2.0-beta.28

## 1.0.0-beta.33

### Patch Changes

- Updated dependencies [5affd84]
  - @askdb/postgres@0.2.0-beta.14
  - @askdb/mysql@0.1.0-beta.13
  - @askdb/sqlite@0.1.0-beta.13
  - @askdb/sqlserver@0.1.0-beta.14
  - @askdb/studio@0.2.0-beta.27

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [9689c3a]
  - @askdb/studio@0.2.0-beta.26

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
