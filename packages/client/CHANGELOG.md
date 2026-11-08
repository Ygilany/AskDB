# @askdb/client

## 1.0.0-beta.13

### Minor Changes

- 0077500: New export `resolveDialect(schema, { override?, configDialect?, unknownDialect? })`, the rule `createAskDb()`'s `ask()` runs to pick a dialect (#886): the override, then the configured dialect, then the schema's `provider` when it's a built-in dialect id, then `"postgres"` for a schema with no provider. Any other provider throws `DialectNotSupportedError`, unless `unknownDialect` is `"fallback-postgres"`. It returns a `DialectResolution` and reads no config. `createAskDb()` now calls it, with the same behavior as before.

### Patch Changes

- Updated dependencies [30d2348]
- Updated dependencies [4e79c4d]
  - @askdb/ai@0.1.0-beta.12

## 1.0.0-beta.12

### Minor Changes

- 1b9468d: `createAskDb` resolves the model and its reasoning effort from the config's typed `ai.language` section (`registry.resolveAiConfigFromSection` and `resolveReasoningEffortFromSection`), since `@askdb/config` no longer builds the `ai.aiEnv` map it read (#711). A host that only calls `createAskDb` needs no code change, but its config must load under `@askdb/config` 1.0.0-beta.19, which removes the deprecated keys (#765). A host that passes its own `registry` builds it with `@askdb/ai` 0.1.0-beta.11 or newer, which has the section methods. With an older registry, the first `ask()` that needs the config's model throws `ModelNotConfiguredError` naming the older `@askdb/ai` and the fix, instead of a `TypeError`. A host that builds the runtime config itself passes `ai.language` with a typed `connection` object. The `reasoningEffort` JSDoc now names `ai.language.reasoning`.

### Patch Changes

- Updated dependencies [6ea8df8]
- Updated dependencies [1b9468d]
- Updated dependencies [d9ab606]
- Updated dependencies [a467984]
- Updated dependencies [54e079e]
  - @askdb/ai@0.1.0-beta.11

## 1.0.0-beta.11

### Minor Changes

- 63d45cc: `createAskDb()` reads its default schema from `host.schemaJson`, then `host.schemaPath`, and no longer falls back to `ASKDB_SCHEMA_JSON` or `ASKDB_SCHEMA_PATH` in `config.ai.aiEnv` (#711). `@askdb/config` writes those keys only from `host.*`, so the fallback mattered only for a runtime config built by hand: set `structured.host` there instead. `SchemaLoadError.source` names `host.schemaJson` or `host.schemaPath (<path>)`.

## 1.0.0-beta.10

### Patch Changes

- f183629: `@askdb/client` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: schema loading, its error labels and dialect resolution work as before.
- Updated dependencies [946dee4]
  - @askdb/ai@0.1.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- 0f4246c: `askdb.bind()` takes `dialect`, which it passes to `bindPreparedQuery()`. Pass the `DialectSpec` you gave `askdb.ask()` when its `preparedQuery.dialectRules` is `"host"`, or, for a template stored without `dialectRules`, the spec `ask()` ran with, or its built-in id if it ran with the built-in rules (#660).
- 96f36ef: `askdb.bind()` takes `tenantSqlMode`, which it passes to `bindPreparedQuery()`. By default the rebound `sql` holds tenant markers and the IDs are in `tenantParams`, as in `askdb.ask()` (#664). If you rebind with a `tenantScope` and run `rebound.sql`, pass `rebound.tenantParams` with it, run `rebound.unboundSql` with `rebound.params`, or set `tenantSqlMode: "sql-only"` to keep the IDs inlined.
- 02387ec: The `@askdb/core`, `@askdb/client` and CLI reference pages now match source (#287). The core and client pages each have an Errors section that lists every error class, its fields, and every rule and reason code. A new `test:errors` check fails the docs-site tests when a class or code in `errors.ts` is missing from its page. The client page names `AskDbClient` and `DialectResolution`, adds `reasoningEffort` and `sensitiveGuardrailMode`, and says what the client caches. The CLI page drops exit code `2`, which no command uses, and adds `askdb introspect templates`, the `askdb ask` output format, glob matching for `--tables`, and the `rag index` and `rag query` output. The `@askdb/client` README says that `reload()` resolves again from the config snapshot the client was created with, so a changed config needs a new client.
- 4d6a315: **Breaking: tenant IDs are driver parameters by default** (`tenantSqlMode: "sql-params"`, #231, ADR 0024).
  
  **What a host must change:** if you pass `tenantScope` to `ask()` (or `askdb.ask()` in `@askdb/client`, which forwards to it) without `tenantSqlMode`, `result.sql` now holds the dialect's driver markers (`$1`, `?` or `@p0`) where the tenant IDs used to be inlined, and the IDs are in `result.tenantParams`. Run `result.sql` with `result.tenantParams`, or `result.unboundSql` with `result.params` (which already holds the tenant IDs); never concatenate the two arrays. To keep the old output, set `tenantSqlMode: "sql-only"`. Running the new `sql` without its params fails at the driver (Postgres: "there is no parameter $1"; better-sqlite3: "Too few parameter values"; MySQL: a syntax error). It never returns other tenants' rows.
  
  **A custom `AskDialect`, or a `DialectSpec` whose `id` isn't built in, has no default.** With a tenant scope and no `tenantSqlMode`, `ask()` now throws `TenantScopeError` with the new reason `TENANT_SQL_MODE_REQUIRED`, before any retrieval or model call. AskDB can't know which parameter markers such a dialect's driver takes, and the `$N` markers it would emit are money constants on SQL Server, where `agency_id = $1` runs and matches agency 1. Set `tenantSqlMode: "sql-params"` if your driver binds `$1`-style markers, or `"sql-only"` to keep the IDs inlined. On any dialect, `ask()` with a tenant scope and `resolveTenantSql()` now throw the same reason for a `tenantSqlMode` that is neither of the two (for example `"sql_only"`) instead of treating it as `"sql-params"`.
  
  `resolveTenantSql()` defaults to `"sql-params"` too. The default is exported as `DEFAULT_TENANT_SQL_MODE`; import it rather than hard-code the mode. Studio's Playground now starts in `sql-params`, and Studio reports that default when a request names no mode.

## 1.0.0-beta.8

### Minor Changes

- 5bd780a: `AskDbClient` gains `bind(prepared, values, options?)`, returning `Promise<BoundQuery>` (ADR 0010, #310). It rebinds a stored `preparedQuery` without calling the model: it resolves the schema the way `ask()` does (per-call `options.schema`, then the client default, then `host.schemaJson` / `ASKDB_SCHEMA_JSON`, then `host.schemaPath` / `ASKDB_SCHEMA_PATH`), expands a `subtree` `tenantScope` with core's `expandTenantScope()` and `options.resolveTenantDescendants`, and forwards to `@askdb/core`'s `bindPreparedQuery()`, which re-checks the template under that schema, scope and modes. The options type, `BindOptions` (`{ tenantScope?, resolveTenantDescendants?, sensitiveGuardrailMode?, acceptWarnings?, schema? }`), is exported. Use it in place of calling core's `bindPreparedQuery()` with a hand-loaded schema.
  
  A normalized schema object passed as `schema` to `ask()` or `bind()` is now used as is when it's a v1 schema (`{ tables }`, no `schemaId`). Before, only a v2 object was recognized, and a v1 object failed with `SchemaLoadError`.
- 3191966: `createAskDb().ask()` now applies config `modes.askdbMode` (#279, ADR 0025). Before, the client ignored it: a call that named no `mode` ran core's default, `schema_only`, whatever the config said. Only the CLI and the HTTP API read the config mode, each on its own.
  
  The config mode is the loosest mode a call gets, the same rule as the `modes.omitSensitiveFromPrompt` floor. A call that names no mode runs the config mode. An unset config counts as `schema_only`. A call's `mode: "schema_only"` tightens a config of `bounded_results` for that call.
  
  The CLI and the HTTP API now pass only the caller's mode to the client, so all three surfaces resolve it the same way. A bad `--mode` still exits 1, and a bad body `mode` or `x-askdb-mode` header still returns `400`.
  
  **Upgrade notes (breaking):**
  
  - A per-call mode can no longer loosen the config. `askdb ask --mode bounded_results`, a client call's `mode: "bounded_results"` and an HTTP request's `mode: "bounded_results"` now run `schema_only` unless `askdb.config.*` sets `modes: { askdbMode: "bounded_results" }`. There's no error: the `askdb.pipeline.mode` log line records the mode that ran. Today's SQL output doesn't change, because `bounded_results` still produces the same SQL as `schema_only`.
  - The `askdb.run.start` log lines from the CLI and the HTTP API no longer carry a `mode` field. Read `mode` from `askdb.pipeline.mode`, which is in the same log stream.
  - `ask()` parses a call's `mode` the way it parses the config's, so `"SCHEMA-ONLY"` tightens like `"schema_only"`, and an unknown value throws `AskDbError` where it used to reach core unchecked. Typed TypeScript callers can't pass one.
  - An invalid `modes.askdbMode` in a hand-built `AskDbRuntimeConfig` makes `ask()` throw `AskDbError`. Config files are validated when they load, as before.

### Patch Changes

- Updated dependencies [aa187f2]
  - @askdb/ai@0.1.0-beta.9

## 1.0.0-beta.7

### Minor Changes

- b01f9fc: `createAskDb().ask()` now treats config `modes.omitSensitiveFromPrompt: true` as a floor. A per-call `omitSensitiveIdentifiersFromNlToSqlPrompt: true` still tightens a single call, but `false` no longer overrides an operator who turned the config on.
  
  `createAskDb().ask()` passes `@askdb/core`'s new `abortSignal` option through, so hosts can enforce timeouts, e.g. `askdb.ask(q, { abortSignal: AbortSignal.timeout(30_000) })`.
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
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.

### Patch Changes

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- 9d2e2b4: **@askdb/core**: `ai` is now a **peer dependency** (`^6.0.0 || ^7.0.51`) instead of a bundled dependency, so the host application owns its AI SDK version.
  
  `ask()` takes a `LanguageModel` your app constructs, so core has to use the same `ai` instance your app does. Bundling `ai` pinned core's own copy: when `1.0.0-beta.41` moved that pin to `ai@^7`, hosts on AI SDK 6 (e.g. `ai@^6` + `@ai-sdk/openai@^3`) had to either migrate their whole AI stack or end up with two copies of `ai` whose `LanguageModel` types disagree. Both AI SDK 6 and AI SDK 7 hosts are now supported.
  
  **Migration (install-time breaking):** if you relied on `ai` arriving transitively through `@askdb/core` (or through `@askdb/postgres`, `@askdb/introspect`, `@askdb/rag`, …), add it to your own `package.json`:
  
  ```bash
  pnpm add ai            # or: npm install ai
  ```
  
  npm 7+ and pnpm (with the default `auto-install-peers`) install a missing required peer automatically, but declaring it pins the version you actually use. Yarn (classic and Berry) doesn't install peers, so Yarn users must add `ai` themselves. That includes introspection-only installs (`@askdb/introspect`, `@askdb/prisma`, the engine packages), because core loads `ai` when it is imported. No source changes are needed.
  
  Core now passes the NL→SQL and enrichment system prompts to `generateText` as `system`, which AI SDK 6 reads and AI SDK 7 still honors as a deprecated alias of `instructions`. This also fixes AI SDK 6 hosts silently losing the system prompt: AI SDK 6 ignores `instructions`.
  
  **@askdb/rag**: the optional `ai` and `@ai-sdk/openai` peers now accept AI SDK 6 as well (`ai` `^6.0.0 || ^7.0.51`, `@ai-sdk/openai` `^3.0.0 || ^4.0.29`), so AI SDK 6 hosts can install `@askdb/rag` without a peer conflict. `createAiSdkEmbedder` works with either major.
  
  **@askdb/studio**: the Playground's "Get the code" install lines now list the required peers. The `@askdb/client` snippet installs `@askdb/core` and `ai` (before, it had no `ai` at all with the AI Gateway provider), and the direct `@askdb/core` snippet installs `ai`, listed once even for the AI Gateway provider, whose SDK is `ai` itself.
  
  **@askdb/client**: the README's install line now lists `@askdb/core` and `ai`, the client's required peers, for package managers that don't install peers (Yarn).
  
  The config-driven path (`@askdb/ai` and `@askdb/client`) still requires AI SDK 7.
- Updated dependencies [e57c734]
- Updated dependencies [11e2457]
- Updated dependencies [e7ea657]
- Updated dependencies [c6e289a]
- Updated dependencies [9021e54]
- Updated dependencies [40e7fee]
  - @askdb/ai@0.1.0-beta.8

## 1.0.0-beta.6

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
- Updated dependencies [5dbe2d6]
- Updated dependencies [2787b21]
- Updated dependencies [933bd6c]
- Updated dependencies [cb7dec5]
- Updated dependencies [8410840]
- Updated dependencies [41f1ed6]
  - @askdb/core@1.0.0-beta.43
  - @askdb/ai@0.1.0-beta.7
  - @askdb/config@1.0.0-beta.12

## 1.0.0-beta.5

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

### Patch Changes

- Updated dependencies [595182d]
- Updated dependencies [1af6263]
- Updated dependencies [1131e77]
  - @askdb/core@1.0.0-beta.42
  - @askdb/ai@0.1.0-beta.6
  - @askdb/config@1.0.0-beta.11

## 1.0.0-beta.4

### Minor Changes

- 0c44b76: Add provider-portable reasoning/latency effort controls for AskDB model calls.

  Set `reasoningEffort: "minimal" | "low" | "medium" | "high"` via `@askdb/ai`'s
  `resolveProviderOptions(config, { reasoningEffort })` and each `@askdb/ai-*`
  adapter maps it to the provider's native knob — OpenAI/Azure
  `providerOptions.openai.reasoningEffort`, Google Gemini 3.x
  `thinkingConfig.thinkingLevel`, Gemini 2.5 `thinkingConfig.thinkingBudget`,
  Anthropic extended `thinking`. Adapters skip models that don't support
  reasoning tuning, so unsupported providerOptions are never sent.

  `@askdb/core`'s `ask()`, `generateSelectSql()`, and `suggestEnrichment()` gain
  an opaque `providerOptions` passthrough forwarded verbatim to `generateText`
  — core stays BYO-model and does not interpret it. Unset, behavior is
  unchanged.

  `askdb.config.*` gains an `ai.reasoning` block (`effort`, `nlToSql`,
  `enrichment`) for per-call-site defaults, flattened to
  `ASKDB_AI_REASONING_EFFORT[_NL_TO_SQL|_ENRICHMENT]` env vars.

  `@askdb/client`'s `createAskDb`/`ask()` now resolve `ai.reasoning` and apply
  it automatically — no manual wiring required for the common client/CLI/HTTP
  API path. `CreateAskDbOptions.reasoningEffort` sets a client-level default;
  `AskOverrides.reasoningEffort` overrides it per call. Studio's sample-question
  and enrichment-suggestion endpoints resolve and forward reasoning effort the
  same way.

  Azure/Foundry deployments are identified by an arbitrary deployment name that
  may not match the underlying model id, so reasoning-model detection can't
  always rely on `model` alone. Set `providerConfig.azure.modelFamily` (or
  `ASKDB_AI_AZURE_MODEL_FAMILY`) to the real model id (e.g. `"gpt-5"`) to
  declare it explicitly when the deployment name doesn't already look like one.

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
  - @askdb/core@1.0.0-beta.41
  - @askdb/config@1.0.0-beta.10

## 1.0.0-beta.3

### Minor Changes

- 7311ac5: **@askdb/client**: `createAskDb()` accepts a new `providers` option — pass the adapter(s) for your configured provider and the client builds the AI registry internally:

  ```ts
  import { createAskDb } from "@askdb/client";
  import { openaiProvider } from "@askdb/ai-openai";

  const askdb = createAskDb({
    config: getAskDbRuntimeConfig(),
    providers: [openaiProvider], // no more createAiRegistry boilerplate
  });
  ```

  You no longer import anything from `@askdb/ai` on the config-driven path — it is now a regular dependency of `@askdb/client` (previously a peer), so install commands drop it too. The existing `registry` option remains supported as the advanced alternative (e.g. sharing one registry across several clients); passing both, or neither, throws with a clear message. Non-breaking for existing `registry` callers.

  **@askdb/studio**: the Playground "Get the code" panel emits the new `providers` style in its config-driven snippet.

### Patch Changes

- 162c33b: Docs only: package READMEs now lead with the `createAskDb({ providers: [...] })` path — no direct `@askdb/ai` import — with the standalone `createAiRegistry` usage kept as the documented advanced alternative.
- Updated dependencies [162c33b]
- Updated dependencies [7311ac5]
  - @askdb/ai@0.1.0-beta.4
  - @askdb/core@1.0.0-beta.36

## 1.0.0-beta.2

### Patch Changes

- Updated dependencies [dc380bc]
  - @askdb/config@1.0.0-beta.9

## 0.1.0-beta.1

### Minor Changes

- 354c833: Add `@askdb/client`: a config-aware `createAskDb()` facade that resolves schema, model, and dialect from the runtime config so callers only pass a question. `schema`, `model`, and `dialect` remain optional per-call overrides. `ask()` in `@askdb/core` is unchanged and remains the pure, BYO-model primitive.
- 354c833: `@askdb/client` now throws typed errors and supports `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API uses those error types to return 400 `schema_parse_error` for missing schema files and to preserve the postgres fallback for unrecognized schema providers.
