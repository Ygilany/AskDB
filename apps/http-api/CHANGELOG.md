# @askdb/http-api

## 1.0.0-beta.52

### Patch Changes

- 30d2348: The READMEs and doc comments say "schema artifact" or "schema directory" instead of "Schema v2" (#273): the http-api `schemaJson` request field's doc comment and README, the enrich, prisma and rag READMEs, and the enrich and rag package descriptions. A `@askdb/postgres` connector comment no longer names an internal `ASKDB_*` key (#629).
- 109c581: Security fix ([GHSA-rhwf-7742-8hwj](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rhwf-7742-8hwj)). The tenant check read a number written right against a keyword (`1.0OR`, `1OR`) as one word, and likewise a `$N` parameter (`$1OR`). MySQL and MariaDB end such a number after its decimal point or exponent, PostgreSQL 14 and earlier at its last digit, and PostgreSQL 14 and CockroachDB end a `$N` parameter at its last digit. So the check missed an `OR` that the engine read, and a tenant-scoped query could pass with its tenant predicate beside it. The check now ends a number where each engine does: after its decimal point or exponent on MySQL and MariaDB, where a name that starts with digits (`3d_models`) stays one name, and at its last digit on PostgreSQL and CockroachDB. Wherever the SQL may be read as Postgres (`postgres`, `cockroachdb`, a dialect id that is no built-in engine, or none), it refuses a `$N` parameter written against a word, as `NOT_SELECT_OR_WITH`. Enforce tenant isolation in the database (for example row-level security) regardless.
- a7756fd: Security fix ([GHSA-rpcp-322q-q738](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rpcp-322q-q738)). The tenant check read some names, comments and joins differently from the engine, so a tenant-scoped query could pass while the engine read it without its tenant filter. The check now reads them the way each engine does:
  
  - **`]]` and nested comments.** On SQL Server, `]]` inside a bracketed name is an escaped `]`, so `[o]] WHERE … AND [x]` is one name. On SQL Server, PostgreSQL and CockroachDB, block comments nest, so the check reads them both nested and not, and a predicate counts only when both readings see it. A predicate inside such a name or comment no longer counts.
  - **Names outside printable ASCII.** SQL Server resolves a name through the database collation, which ignores some characters (U+200D, U+FEFF, any emoji) and reads others as ASCII letters (fullwidth letters, small capitals), so `[ｏｒｄｅｒｓ]` reads `orders`. Under `sqlserver`, a dialect id that is no built-in engine, or none, the tenant check refuses a name, quoted or not, that holds a character outside printable ASCII as `UNICODE_ESCAPED_IDENTIFIER`, and the sensitive check reports it as unresolved scope, unless the schema spells it exactly. This covers aliases and CTE names too.
  - **Column lists after an alias.** PostgreSQL and CockroachDB read `orders t (agency_id, x)` as new names for the table's first columns, so `t.agency_id` filtered another column. A column list on a parenthesized join or derived table renames its output the same way, so in `(orders o JOIN lookup_states s ON true) AS j (a1, a2, agency_id)` an unqualified `agency_id` was the join's third column. Wherever the SQL may be read as Postgres, such a read is refused as `MISSING_TENANT_PREDICATE`.
  - **Outer joins with a hint.** A join with `LEFT`, `RIGHT`, `FULL` or `OUTER` among its words is outer, whatever hint stands beside it, so CockroachDB's `LEFT STRAIGHT JOIN`, `LEFT LOOKUP JOIN` and `LEFT INVERTED JOIN` no longer count their `ON` as a filter. Neither does an `ON` that closes an earlier join (`a LEFT JOIN b JOIN c ON … ON …`).
  - **Quoted tenant columns.** PostgreSQL and CockroachDB compare a quoted name exactly, so `"AGENCY_ID"` can be another source's column. Wherever the SQL may be read as Postgres, a quoted tenant column counts only when spelled as the schema spells it.
  - **SQLite's single-quoted table names.** SQLite reads a `'…'` in a table's place as the table's name, so `SELECT * FROM 'orders'` read `orders` with no tenant predicate, and `SELECT * FROM 'users'` reached its sensitive columns. Under `sqlite`, a dialect id that is no built-in engine, or none, such a string right after `FROM`, `JOIN` or `IN`, after a `,` in a `FROM` list, or beside a `.` is now read as the table's name by the tenant and sensitive checks. SQLite also reads a `'…'` right after a table or CTE reference as its alias, so in `FROM sub_agencies 'o', orders` a predicate on `o.agency_id` filters `sub_agencies`, not `orders`; the tenant check now reads it as that alias.
  - **Quoted names spelled like a placeholder.** A quoted name such as `":tenant_agency_ids"`, `` `:tenant_agency_ids` `` or `[:tenant_agency_ids]` is a column to the engine and nothing binds it, but the check counted it as the placeholder. It no longer does. A U+0001 inside a quoted name no longer changes which later words the check reads as keywords.
  
  Enforce tenant isolation in the database (for example row-level security) regardless.
- Updated dependencies [30d2348]
- Updated dependencies [4e79c4d]
- Updated dependencies [0077500]
- Updated dependencies [f59a7e1]
- Updated dependencies [30d2348]
- Updated dependencies [dc750be]
- Updated dependencies [6320c85]
- Updated dependencies [f11909c]
- Updated dependencies [4e79c4d]
- Updated dependencies [30d2348]
- Updated dependencies [4188c04]
- Updated dependencies [97312e1]
- Updated dependencies [39a4a5e]
- Updated dependencies [8069854]
- Updated dependencies [f11909c]
- Updated dependencies [4e79c4d]
- Updated dependencies [109c581]
- Updated dependencies [a7756fd]
  - @askdb/ai@0.1.0-beta.12
  - @askdb/client@1.0.0-beta.13
  - @askdb/config@1.0.0-beta.20
  - @askdb/core@1.0.0-beta.52

## 1.0.0-beta.51

### Minor Changes

- 4882ef5: With no schema configured server-side, `askdb-http` answers `500 generation_not_configured`, not `400 bad_request` (#845). No `--schema-path`, `host.schemaJson` or `host.schemaPath` is the operator's to fix, like a server schema that doesn't load (#840), so the message is generic and the `askdb.run.error` log line's `errName` (`SchemaNotConfiguredError`) names the cause. A request that sends its own `schemaJson` is unaffected.

### Patch Changes

- 4196800: Security fix ([GHSA-rmjw-pffc-5hjr](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rmjw-pffc-5hjr)), a residual of [GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4) finding 1. The tenant check read a dollar-quoted string whose tag holds non-ASCII letters (`$é$ … $é$`) as code, where Postgres, CockroachDB and the shared lexer read it as a string, so a tenant-scoped query could pass the check without an effective tenant predicate. The check's scanner now reads the tag with the same character set as the shared lexer and the engine. Enforce tenant isolation in the database (for example row-level security) regardless.
- Updated dependencies [6c8c88b]
- Updated dependencies [8e75d50]
- Updated dependencies [4196800]
  - @askdb/core@1.0.0-beta.51
  - @askdb/client@1.0.0-beta.12

## 1.0.0-beta.50

### Minor Changes

- 1b9468d: `askdb ask`, `askdb rag` and Studio build their models from the config's typed `ai.language` and `ai.embedding` sections, since `@askdb/config` no longer builds the AI env maps they read (#711). `askdb rag --embedder-model` still overrides `ai.embedding.model`. A config that sets a key `@askdb/config` 1.0.0-beta.19 removed (#765), such as `model` on an `ai.providerConfig` connection or `rag.embedder: "openai"`, now fails to load in the CLI, Studio and the HTTP API, with an error naming each key's replacement; the upgrade guide shows each one before and after.
- 58b4a90: `askdb-http` reads the working directory's `.env` first, and never a `.env` inside `node_modules` (#839). Its first candidate was the `.env` three directories above its `dist` folder, which in an npm install is `node_modules/.env`, so that file won over `./.env`. The working directory's `.env` now comes first. The package folder's and the repository root's follow only when the binary runs from AskDB's own source checkout, never from inside `node_modules`, so an install (or a package folder copied out of one) reads only the working directory's `.env`.
- ccc484a: A request `schemaJson` gets SQL for its own engine (#809). The server generated and checked SQL for the `dialect` in `askdb.config.*` whatever a request schema's `provider` recorded, so a server configured for `postgres` returned PostgreSQL SQL, checked under PostgreSQL's rules, for a schema that recorded `mysql`. The server now passes a request schema's `provider` to `ask()` as its dialect, so generation and the read-only, tenant and sensitive checks run under that engine; the config's `dialect` applies to the server's own schema only. A request schema that records no `provider`, or one AskDB has no dialect for, answers `400 bad_request` with a message that names the provider (or says there is none) and the supported dialect ids, whether or not the config sets `dialect`. A caller that relied on the server's `dialect`, such as one sending a MariaDB artifact (which records `mysql`) to a server set to `mariadb`, now gets SQL for the recorded engine.
- 58b4a90: A server schema that doesn't load answers `500 generation_not_configured`, not `400 schema_parse_error` (#840). A wrong `host.schemaPath` answered any caller with a client error whose message held the server's absolute path. The message is now generic and names no path, and the `askdb.run.error` log line keeps the full `SchemaLoadError`. A request `schemaJson` that doesn't load still answers `400 schema_parse_error`.
- b64077c: **`askdb-http` refuses a schema whose `provider` has no AskDB dialect, and names a tenant-policy schema's error** (#720, #716). The server built its client with `unknownDialect: "fallback-postgres"`, so a schema recorded by an engine AskDB doesn't ship, such as Snowflake, got PostgreSQL SQL with `200`, checked under PostgreSQL's rules, while `askdb ask` refused it. The server now refuses it. The server's configured schema answers `500 generation_not_configured`, with a generic message, and the log's `errName` (`DialectNotSupportedError`) tells it apart from a missing model. A request `schemaJson` answers `400 bad_request`, with a message that names its provider and the supported dialect ids. A schema with a tenant policy, which the server can't scope (#343), now answers `500 tenant_scope_not_configured`, a new error code, instead of the generic `500 internal_error`. It still returns no SQL and never calls the model. A `TenantScopeError` with any other reason stays the generic `500`.

### Patch Changes

- 542e2eb: README: example variable names are neutral (`SCHEMA_PATH`, `MOCK_SQL`), as plan 019 requires, and the `.env` lookup order matches what the binary does.
- 91e89ec: Security fix ([GHSA-8pwj-6hfv-5pm4](https://github.com/Ygilany/AskDB/security/advisories/GHSA-8pwj-6hfv-5pm4)). The tenant check could read some SQL differently from the database engine — a `$` inside a name, a table named after a keyword such as `user` or `lock`, an unset `backslashEscapes` on a from-scratch MySQL-family `DialectSpec`, and where a `--` comment ends — so a tenant-scoped query could pass the check without an effective tenant predicate. The check now reads each construct the way the engine does, and a test per engine confirms it on a live database. Tenant isolation enforced in the database (for example row-level security), as `SECURITY.md` recommends, still limited what such a query could read.
- Updated dependencies [6ea8df8]
- Updated dependencies [1b9468d]
- Updated dependencies [d9ab606]
- Updated dependencies [a467984]
- Updated dependencies [54e079e]
- Updated dependencies [1b9468d]
- Updated dependencies [6ea8df8]
- Updated dependencies [1ccc8c8]
- Updated dependencies [1b9468d]
- Updated dependencies [1b9468d]
- Updated dependencies [3841e09]
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
- Updated dependencies [91e89ec]
  - @askdb/ai@0.1.0-beta.11
  - @askdb/client@1.0.0-beta.12
  - @askdb/config@1.0.0-beta.19
  - @askdb/core@1.0.0-beta.50

## 1.0.0-beta.49

### Patch Changes

- 4437394: Security fix ([GHSA-wjgj-mf9h-6g68](https://github.com/Ygilany/AskDB/security/advisories/GHSA-wjgj-mf9h-6g68)). With `tenantSqlMode: "sql-only"` on the built-in `postgres` or `cockroachdb` dialect, `ask()` could return SQL whose tenant scoping no longer held once the tenant IDs were inlined, because it did not re-check the rendered statement. `ask()` now runs the read-only check on the `sql` it returns, as `bindPreparedQuery()` already does, and refuses a statement that reads differently once rendered. The default `tenantSqlMode: "sql-params"`, which binds tenant IDs as driver parameters, was never affected.
- Updated dependencies [150a293]
- Updated dependencies [0e5d542]
- Updated dependencies [4a83b61]
- Updated dependencies [a8cef1b]
- Updated dependencies [ca816cc]
- Updated dependencies [29a0fc1]
- Updated dependencies [396ad23]
- Updated dependencies [4437394]
  - @askdb/config@1.0.0-beta.18
  - @askdb/core@1.0.0-beta.49
  - @askdb/client@1.0.0-beta.11

## 1.0.0-beta.48

### Minor Changes

- 63d45cc: The HTTP API server and the CLI use `logging.level` as `@askdb/config` resolves it, without checking it again (#711). Behavior is unchanged: the config already refuses a level that isn't one of `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` when it loads.

### Patch Changes

- c28c967: Depend on `zod` (`^4.6.7`, the same range as `@askdb/core`), the peer that `ai` and the `@ai-sdk/*` packages require, so Yarn Plug'n'Play can resolve it (#748). `yarn dlx askdb` crashed at startup because these packages install `ai` without providing its `zod`. npm and pnpm already installed `zod` through `@askdb/core`, so they install nothing new.
- Updated dependencies [63d45cc]
- Updated dependencies [63d45cc]
- Updated dependencies [294ef92]
- Updated dependencies [f8f99cb]
- Updated dependencies [180f28a]
- Updated dependencies [9e49e34]
- Updated dependencies [b52a89f]
- Updated dependencies [229a592]
  - @askdb/client@1.0.0-beta.11
  - @askdb/config@1.0.0-beta.17
  - @askdb/core@1.0.0-beta.48

## 1.0.0-beta.47

### Patch Changes

- f4e60a9: `createAskDbLogger()` opens each `logFile` path once per process and shares it across loggers, instead of opening it again for every logger (#693). Hosts build a logger per request, so the HTTP API server leaked one file descriptor per `POST /ask` with `logging.logFile` set, until it ran out of descriptors and stopped serving. The file now stays open for the life of the process. Rotate it with `copytruncate`, or restart the process after a rotate. The configuration and core API references and the upgrade guide say so.
- 32a7bc8: `@askdb/http-api` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: responses, log levels and log entries are the same as before.
- Updated dependencies [946dee4]
- Updated dependencies [f183629]
- Updated dependencies [3d9bc33]
- Updated dependencies [f4e60a9]
- Updated dependencies [80c7ddf]
- Updated dependencies [0a94c6f]
- Updated dependencies [4f322db]
- Updated dependencies [4365d4c]
  - @askdb/ai@0.1.0-beta.10
  - @askdb/client@1.0.0-beta.10
  - @askdb/config@1.0.0-beta.16
  - @askdb/core@1.0.0-beta.47

## 1.0.0-beta.46

### Patch Changes

- Updated dependencies [47eef72]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [2234954]
- Updated dependencies [d82125c]
- Updated dependencies [b40309d]
- Updated dependencies [f3decbb]
- Updated dependencies [7ca1940]
- Updated dependencies [02387ec]
- Updated dependencies [234eec0]
- Updated dependencies [0f4246c]
- Updated dependencies [96f36ef]
- Updated dependencies [cdab7d7]
- Updated dependencies [ed7f35c]
- Updated dependencies [4d6a315]
- Updated dependencies [4d6a315]
  - @askdb/core@1.0.0-beta.46
  - @askdb/client@1.0.0-beta.9
  - @askdb/config@1.0.0-beta.15

## 1.0.0-beta.45

### Minor Changes

- 3191966: `createAskDb().ask()` now applies config `modes.askdbMode` (#279, ADR 0025). Before, the client ignored it: a call that named no `mode` ran core's default, `schema_only`, whatever the config said. Only the CLI and the HTTP API read the config mode, each on its own.
  
  The config mode is the loosest mode a call gets, the same rule as the `modes.omitSensitiveFromPrompt` floor. A call that names no mode runs the config mode. An unset config counts as `schema_only`. A call's `mode: "schema_only"` tightens a config of `bounded_results` for that call.
  
  The CLI and the HTTP API now pass only the caller's mode to the client, so all three surfaces resolve it the same way. A bad `--mode` still exits 1, and a bad body `mode` or `x-askdb-mode` header still returns `400`.
  
  **Upgrade notes (breaking):**
  
  - A per-call mode can no longer loosen the config. `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `mode: "bounded_results"` now run `schema_only` unless `askdb.config.*` sets `modes: { askdbMode: "bounded_results" }`. There's no error: the `askdb.pipeline.mode` log line records the mode that ran. Today's SQL output doesn't change, because `bounded_results` still produces the same SQL as `schema_only`.
  - The `askdb.run.start` log lines from the CLI and the HTTP API no longer carry a `mode` field. Read `mode` from `askdb.pipeline.mode`, which is in the same log stream.
  - `ask()` parses a call's `mode` the way it parses the config's, so `"SCHEMA-ONLY"` tightens like `"schema_only"`, and an unknown value throws `AskDbError` where it used to reach core unchecked. Typed TypeScript callers can't pass one.
  - An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are validated when they load, as before.
- d9b88f8: `createAskDbHttpServer()` now loads its config when you create it, as the docs said it did (#280). Before, it never bootstrapped, so a host that didn't call `bootstrapAskDbEnv()` first got `500 internal_error` on every `POST /ask`. When no runtime snapshot is installed, the server calls `bootstrapAskDbEnv()` from `process.cwd()`, loading `.env` and `askdb.config.*`. When your process already bootstrapped, it uses that snapshot and loads nothing, so a host that bootstraps from another directory keeps its config.
  
  Two behavior changes for hosts that embed the server:
  
  - `createAskDbHttpServer()` throws when it has to bootstrap and finds no `askdb.config.*` in the working directory, or can't read an existing `.env`. It no longer starts a server that fails every request.
  - Omitted `port` and `host` options now fall back to `httpApi.listen.port` and `httpApi.listen.host`, then to `3000` and `127.0.0.1`, the same precedence as the `askdb-http` binary. A host that sets `httpApi.listen` in its config but relied on the defaults now listens on the configured address.

### Patch Changes

- Updated dependencies [5bd780a]
- Updated dependencies [3191966]
- Updated dependencies [d9b88f8]
- Updated dependencies [c099a66]
- Updated dependencies [5bd780a]
- Updated dependencies [61f23b0]
- Updated dependencies [798cc4f]
- Updated dependencies [aa187f2]
- Updated dependencies [e8afa01]
  - @askdb/client@1.0.0-beta.8
  - @askdb/config@1.0.0-beta.14
  - @askdb/core@1.0.0-beta.45
  - @askdb/ai@0.1.0-beta.9

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
- b01f9fc: Harden `POST /ask` error handling, sensitivity, and schema overrides.
  
  - **Errors map by type.** Before, any error whose message contained "mode" returned `400`. That included every model-provider failure ("Model call failed: …"), which also sent the provider's raw text to the client and skipped logging. Now `SqlGenerationError` returns `502 sql_generation_error` with a generic message. `SensitiveReferenceError` and `TenantGuardrailError` map to `422 guardrail_violation`, though the server can't raise either today (it runs the sensitive check in warn mode and can't pass a tenant scope, so a tenant-policy schema returns `500`). Unknown errors return a generic `500 internal_error`. Provider error text is never returned. Every non-`2xx` `POST /ask` response, including an early `400`/`403`/`413` rejection, is logged as `askdb.run.error` with its `status` and `code` under the response's `correlationId`; failures inside `ask()` also log the full error. The exception is a last-resort `500` for an error that escapes the handler, which is written to stderr.
  - **`mode` is validated up front.** An invalid body `mode` or `x-askdb-mode` header returns `400 bad_request`.
  - **Config `modes.omitSensitiveFromPrompt` is honored.** A request's `omitSensitiveFromPrompt` can tighten it but not loosen it.
  - **Breaking: `omitSensitiveFromPrompt` must be a boolean.** A string or number (`"true"`, `1`) used to count as "omit"; it now returns `400 bad_request` instead of reaching the model.
  - **Breaking: `explain` must be a boolean.** It used to go through `Boolean(...)`, so `"false"` turned it on; any non-boolean now returns `400 bad_request`. For every optional body field, JSON `null` counts as absent.
  - **`sensitiveGuardrail` is returned** in the success response when the schema marks something `sensitive`.
  - **Breaking: per-request `schemaJson` is off by default.** A request that sends it now gets `403 schema_override_disabled`. Set `httpApi.allowSchemaOverride: true` to accept overrides again.
  - **Model-call timeout.** Controlled by `httpApi.requestTimeoutMs` (default `60000`, at most `2147483647`). A timed-out request returns `502`.
  - **Cleaner startup errors.** `askdb-http` prints a one-line error and exits `1` when it can't bind (e.g. `EADDRINUSE`) or can't load config. Before, it printed a raw stack trace.
  - **Fixed `generation_not_configured` hint.** It now points to `ai.providerConfig` / `dev.mockSql` instead of `ASKDB_MOCK_SQL`, which the server does not read from the environment.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

### Patch Changes

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- c55bfb3: **@askdb/http-api**: drop the unused `@askdb/postgres` dependency — nothing in the HTTP API imports it (it returns SQL and never connects to a database). The `pg` dependency was already dropped separately.
  
  **@askdb/studio**: align the optional driver peer ranges with the engine packages that actually load them — `better-sqlite3 >=12` (was `>=9`) and `mssql >=12` (was `>=10`). The dev dependencies already matched.
- fa2e771: Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.
- Updated dependencies [e57c734]
- Updated dependencies [11e2457]
- Updated dependencies [e7ea657]
- Updated dependencies [f506c14]
- Updated dependencies [c610168]
- Updated dependencies [b01f9fc]
- Updated dependencies [c6e289a]
- Updated dependencies [0009bb1]
- Updated dependencies [b01f9fc]
- Updated dependencies [9847a87]
- Updated dependencies [9d2e2b4]
- Updated dependencies [224a05b]
- Updated dependencies [d6e52ed]
- Updated dependencies [ce8d837]
- Updated dependencies [194de19]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
- Updated dependencies [3ad781b]
- Updated dependencies [cca5656]
- Updated dependencies [f2f6239]
- Updated dependencies [fa2e771]
- Updated dependencies [7a0f777]
- Updated dependencies [5d3a38b]
  - @askdb/ai@0.1.0-beta.8
  - @askdb/config@1.0.0-beta.13
  - @askdb/core@1.0.0-beta.44
  - @askdb/client@1.0.0-beta.7

## 1.0.0-beta.43

### Minor Changes

- cc176d1: Breaking (pre-1.0, so a minor bump):

  - Require Node `>=22.12` consistently: `askdb`, `@askdb/http-api`, and `@askdb/studio` previously declared `>=22`, but the libraries they depend on already required `>=22.12`.
  - `@askdb/http-api` and `@askdb/studio` now declare an `exports` map: `.` (the package entry) and `./package.json`. Deep imports of other files, such as `@askdb/studio/dist/server.js`, are no longer allowed; import from the package entry instead.

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 5e89384: **@askdb/core**: Documentation-only. The `validateTenantGuardrails` docstring (shipped in the `.d.ts`) now opens by calling the check a best-effort lint, and says it is not a SQL parser and not a security boundary, with real tenant isolation coming from the database, and that `global` scope skips it. The `AskDialect` generator's output docstring no longer calls the SQL validated (a custom dialect's SQL isn't checked unless it calls `validateSelectSql`). The package README adds a short security-model note: AskDB's SQL checks are defense in depth, and generated SQL should run under a read-only, least-privilege role with tenant isolation enforced in the database. No runtime behavior changes.

  **@askdb/docs-site**: The safety, multi-tenancy, and reference pages describe AskDB's SQL guardrails as they behave today: heuristic checks that are defense in depth, not a security boundary, with a new "Run generated SQL safely" section and the sensitive-column check's known gaps. A new "Match your server's string settings" section shows the `DialectSpec` (`backslashEscapes`) a MySQL/MariaDB server with `NO_BACKSLASH_ESCAPES`, or Postgres with `standard_conforming_strings = off`, needs, and the Core API reference documents `backslashEscapes`. The production guide's database-role example no longer relies on a `REVOKE` on `pg_catalog` that has no effect, and explains what does limit catalog access on Postgres. Pages and diagrams now say "checked SQL" throughout. The production guide's example role also sets `default_transaction_read_only`, because table grants alone don't stop every write on Postgres.

  **askdb**, **@askdb/http-api**: The package descriptions and READMEs say "checked SQL" instead of "validated SQL", matching the docs. No behavior change.

- 7fa7d87: **@askdb/http-api**: Drop the hard `pg` dependency. The server only generates and validates SQL — it never connects to a database — and nothing in the package imports `pg`, so installing `@askdb/http-api` no longer pulls in a Postgres driver. This matches the documented install model where database drivers (`pg`, `mysql2`, `better-sqlite3`, `mssql`) are optional peers that the host app installs only when it runs its own execution or live introspection code. Host apps that relied on `pg` arriving transitively through `@askdb/http-api` should add it to their own `package.json`.
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
- Updated dependencies [5dbe2d6]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/ai-anthropic@1.0.0-beta.5
  - @askdb/ai-azure@1.0.0-beta.7
  - @askdb/ai-google@1.0.0-beta.7
  - @askdb/ai-openai@1.0.0-beta.7
  - @askdb/ai@0.1.0-beta.7
  - @askdb/client@1.0.0-beta.6
  - @askdb/config@1.0.0-beta.12
  - @askdb/postgres@0.2.0-beta.19

## 1.0.0-beta.42

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/ai@0.1.0-beta.6
  - @askdb/ai-anthropic@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.6
  - @askdb/ai-google@1.0.0-beta.6
  - @askdb/ai-openai@1.0.0-beta.6
  - @askdb/client@1.0.0-beta.5
  - @askdb/config@1.0.0-beta.11
  - @askdb/postgres@0.2.0-beta.18

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
  - @askdb/postgres@0.2.0-beta.17

## 1.0.0-beta.40

### Patch Changes

- Updated dependencies [350c03a]
  - @askdb/core@1.0.0-beta.40
  - @askdb/client@1.0.0-beta.3
  - @askdb/postgres@0.2.0-beta.16

## 1.0.0-beta.36

### Minor Changes

- 7311ac5: Surface token usage through the full AskDB stack and add comprehensive API reference documentation.

  **@askdb/core** — new `AskUsage` type (`promptTokens`, `completionTokens`, `totalTokens`); `generateSelectSql` now captures token usage from the `generateText` result; `AskDialectGenerateResult` and `AskPipelineResult` both include `usage?: AskUsage`; exported from the package index.

  **@askdb/http-api** — `POST /ask` success response now includes `usage: AskUsage | null`.

  **@askdb/studio** — Token usage re-added to the Query Playground (was dropped in the IA redesign migration); `UsageSummary` extracted to a shared component used by both the Playground and RAG Index page; display now correctly shows Prompt, Completion, and Embeddings rows individually.

### Patch Changes

- Updated dependencies [7311ac5]
- Updated dependencies [162c33b]
- Updated dependencies [7311ac5]
  - @askdb/client@1.0.0-beta.3
  - @askdb/ai@0.1.0-beta.4
  - @askdb/ai-openai@1.0.0-beta.4
  - @askdb/ai-anthropic@1.0.0-beta.2
  - @askdb/ai-google@1.0.0-beta.4
  - @askdb/ai-azure@1.0.0-beta.4
  - @askdb/core@1.0.0-beta.36
  - @askdb/postgres@0.2.0-beta.15

## 1.0.0-beta.33

### Patch Changes

- Updated dependencies [5affd84]
  - @askdb/postgres@0.2.0-beta.14

## 1.0.0-beta.30

### Patch Changes

- Updated dependencies [dc380bc]
- Updated dependencies [dc380bc]
  - @askdb/postgres@0.2.0-beta.13
  - @askdb/config@1.0.0-beta.9
  - @askdb/client@1.0.0-beta.2

## 1.0.0-beta.29

### Patch Changes

- 354c833: `@askdb/client` now throws typed errors and supports `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API uses those error types to return 400 `schema_parse_error` for missing schema files and to preserve the postgres fallback for unrecognized schema providers.
- 354c833: Resolve schema, model, and dialect via the new `@askdb/client` facade instead of duplicating the logic in each host. No behavior change: same dialect precedence, mock-SQL path, and error responses.
- Updated dependencies [354c833]
- Updated dependencies [354c833]
  - @askdb/client@0.1.0-beta.1

## 1.0.0-beta.28

### Minor Changes

- 24f3632: Add `--schema-path`, `--port`, and `--host` flags to the standalone HTTP server CLI.

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

- Updated dependencies [d4a0a1d]
- Updated dependencies [4dd7a59]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
- Updated dependencies [96e6963]
  - @askdb/ai-anthropic@1.0.0-beta.1
  - @askdb/ai@0.1.0-beta.3
  - @askdb/config@1.0.0-beta.8
  - @askdb/ai-openai@1.0.0-beta.3
  - @askdb/ai-azure@1.0.0-beta.3
  - @askdb/ai-google@1.0.0-beta.3

## 1.0.0-beta.26

### Patch Changes

- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
- Updated dependencies [baf5ad8]
  - @askdb/ai@0.1.0-beta.2
  - @askdb/ai-openai@0.1.0-beta.2
  - @askdb/ai-azure@0.1.0-beta.2
  - @askdb/ai-google@0.1.0-beta.2
  - @askdb/core@1.0.0-beta.26
  - @askdb/postgres@0.2.0-beta.12

## 1.0.0-beta.24

### Patch Changes

- Updated dependencies [05a589a]
  - @askdb/config@1.0.0-beta.7

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/postgres@0.2.0-beta.11

## 1.0.0-beta.20

### Patch Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/postgres@0.2.0-beta.10
  - @askdb/ai@0.1.0-beta.1
  - @askdb/ai-openai@0.1.0-beta.1
  - @askdb/ai-azure@0.1.0-beta.1
  - @askdb/ai-google@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20

## 1.0.0-beta.19

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6

## 0.5.0-beta.18

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/postgres@0.2.0-beta.9

## 0.5.0-beta.17

### Patch Changes

- @askdb/postgres@0.2.0-beta.8

## 0.5.0-beta.16

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16
  - @askdb/postgres@0.2.0-beta.7

## 0.5.0-beta.14

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14
  - @askdb/postgres@0.2.0-beta.6

## 0.5.0-beta.13

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5

## 0.5.0-beta.12

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12
  - @askdb/postgres@0.2.0-beta.5

## 0.5.0-beta.11

### Patch Changes

- Updated dependencies [cd364e3]
  - @askdb/postgres@0.2.0-beta.4

## 0.5.0-beta.10

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10
  - @askdb/postgres@0.2.0-beta.3

## 0.5.0-beta.4

### Patch Changes

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/core@0.5.0-beta.4
  - @askdb/postgres@0.2.0-beta.2

## 0.5.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1
  - @askdb/postgres@0.2.0-beta.1

## 0.5.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 289e63e: First public pre-1.0 release.

  `@askdb/core` ships the NL→SQL pipeline (`ask`), the BYO executor seam
  (`AskDbExecutor`, `TabularResult`), and the validated read-only PostgreSQL
  guardrail. `pg` is an **optional peer dependency** — consumers using a custom
  `executor` never need to install it. The built-in helpers live behind the
  `@askdb/core/postgres` subpath and lazy-load `pg` on first invocation, with a
  helpful error if the peer is missing.

  `@askdb/cli` (`askdb` binary) and `@askdb/http-api` (`askdb-http` binary,
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

- cd23f50: **Breaking change (pre-1.0):** Schema v2 replaces the previous format. `loadSchema()` and `loadSchemaFromJson()` are the new entry points; the pre-v2 format is rejected with a clear error pointing at `docs/contracts/schema-v2.md`.

  New exports: `loadSchema`, `loadSchemaFromJson`, `parseTableMarkdown`, `parseConceptsMarkdown`, `writeTableMarkdown`, `writeConceptsMarkdown`, `formatSchemaV2ForNlToSql`, and all v2 types. `ask()` now accepts both `NormalizedSchema` (legacy) and `NormalizedSchemaV2`.

  CLI and HTTP API transparently pick up Schema v2 — pass a v2 directory path to `--schema` / `ASKDB_SCHEMA_PATH`.

### Patch Changes

- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- 25980e4: Centralize optional `askdb.config` defaults in `flattenAskDbConfig` instead of `optionalEnv`. `env()` now returns `undefined` when unset; add `requiredEnv` for fail-fast reads. Introduce `defaults.ts`, align the default RAG file-store path with `./askdb/rag`, and emit `ASKDB_PGVECTOR_INDEX_STRATEGY` when flattening pgvector. Refresh the `askdb init` template, root `askdb.config.ts`, and documentation.
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [25980e4]
- Updated dependencies [ec3ae3d]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
  - @askdb/config@0.3.0-beta.0
  - @askdb/postgres@0.2.0-beta.0
