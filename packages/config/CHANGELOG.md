# @askdb/config

## 1.0.0-rc.1

### Major Changes

- 80947b2: **These 12 packages move to the 1.0 release line, and from now on they share one version** (#354). This release is `1.0.0-rc.1` for all of them. `@askdb/ai`, `@askdb/introspect`, `@askdb/prisma` and the four engine packages jump from `0.x` to it. Every later release publishes all 12 at the same version, including a package that didn't change, so one version number names a set that works together. `@askdb/studio`, `@askdb/enrich` and `@askdb/rag` stay on `0.x` (`0.2.0-rc.1` here), because their APIs can still change.
  
  Release candidates publish under npm's `latest` dist-tag, as the betas did, so `npm install askdb` gets the newest one. From `1.0.0` on, a breaking change to any of the 12 is a major release of all 12, except in the experimental surfaces (the Studio and RAG surfaces of `@askdb/config` and the CLI, `@askdb/config/scaffold` and `@askdb/client/charts`; [ADR 0030](https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0030-1-0-promises-checked-sql-only.md)), which can change in a minor release. `1.0.0-rc.1` freezes their public API (ADR 0030): later release candidates fix bugs, and the upgrade guide lists anything a fix asks your app to change.
  
  **Upgrade notes:** a range written for a `0.x` version doesn't match `1.0.0-rc.1`. For example, with `"@askdb/ai": "^0.1.0-beta.9"`, `npm update` stops at the newest `0.1.0-beta.*` and never installs `1.0.0-rc.1`. Install each AskDB package your app lists at `@latest` in one step, as the upgrade guide's 1.0.0-rc.1 section shows.

## 1.0.0-beta.20

### Minor Changes

- f59a7e1: `bootstrapAskDbEnv()` and `loadAskDbConfigProjection*()` load a JavaScript config (`askdb.config.js`, `.cjs`, `.mjs`) with Node's own loader, and create jiti only for a TypeScript config (`.ts`, `.mts`, `.cts`) (#833). A JavaScript config now loads from inside an app's bundle, webpack included, where jiti can't start. Node's module rules now apply to it: a `.js` config that relied on jiti may fail with Node's own error, such as `SyntaxError: Unexpected token 'export'` for ES module syntax beside a `package.json` with `"type": "commonjs"`, or a config that imports TypeScript written for a compiler. Rename it to `.mjs` or `.ts`. Node also keeps an ES module config that threw while loading, so loading it again in the same process, as Studio does after an `.env` edit, fails with an error that says to restart. A TypeScript config loads as before.
- 6320c85: **Breaking:** an unknown `studio.execute.provider` now fails to load with `askdb.config: invalid studio.execute.provider "<value>" (expected one of: postgres, mysql, sqlite, sqlserver).` (#751), like every other config key since #737. Before, it fell back without a word to the introspection provider, or `postgres`, so a typo could point Studio's Execute at an engine the config didn't name. An unset provider still falls back the same way. For this key and every other key with a fixed list of values, the error repeats a rejected value only when it's a bare word, so a connection string pasted into the wrong key isn't printed. The upgrade guide's beta.52 section shows the fix.
- f11909c: **Breaking:** `@askdb/config` no longer exports `flattenAskDbConfig`, `isAskDbEnvProjection` or `ASKDB_ENV_PROJECTION` (#830). Nothing outside the package imported them, and its API page listed them as internal. `defineConfig(config).entries` is the same map `flattenAskDbConfig(config)` returned. Loading a config file and `bootstrapAskDbEnv()` behave as before. `mergeAskDbFlatIntoEnvMap` and `getAskDbRuntimeConfig().flat` stay exported while Studio still reads the flat map (#752).
- 4e79c4d: **Breaking:** `bootstrapAskDbRuntime`, an alias of `bootstrapAskDbEnv`, is removed, and `ASKDB_CONFIG_EXTENSION_PRECEDENCE`, `DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS`, `DEFAULT_PGVECTOR_INDEX_STRATEGY`, `DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS`, `DEFAULT_STUDIO_EXECUTE_MAX_ROWS` and `DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS` are no longer exported (#654): nothing outside `@askdb/config` used them, so they leave before 1.0 (ADR 0031). Call `bootstrapAskDbEnv()`, and read resolved values from `getAskDbRuntimeConfig()`. The not-initialized error now names only `bootstrapAskDbEnv()`. On the experimental `@askdb/config/scaffold` entry point, `renderAskDbAiConfigScaffold` and the types `AskDbAiConfigScaffold` and `AskDbScaffoldEnvVar` are no longer exported: `planAskDbScaffold` renders the `ai` block. The upgrade guide's beta.52 section lists each replacement.

### Patch Changes

- 30d2348: The doc comments on `AskDbConfig` and its blocks no longer name the internal `ASKDB_*` keys each value is copied to, such as `ASKDB_INTROSPECT_OUT` (#629): AskDB never reads those from the environment. The `rag` and `studio` blocks now say they are experimental, with a link to ADR 0030: a minor release of `@askdb/config` may change them (#662). The README no longer mentions a bootstrap-time allowlist of shell variables, which was removed.
- dc750be: `isLikelyWorkspaceRoot()` in `@askdb/config/scaffold` counts a `pnpm-workspace.yaml` only when it lists at least one package under `packages` (#863). pnpm also keeps project settings in that file, such as `minimumReleaseAgeExclude`, so a one-package project with a settings-only file was read as a workspace root, and `askdb init` and Studio's guided setup skipped their install there. A `package.json` with `workspaces` still counts. The helper reads plain block YAML, and a file in any other form still counts as a workspace root.

## 1.0.0-beta.19

### Minor Changes

- 6ea8df8: A config whose `ai.providerConfig.<provider>.baseUrl` holds a username or password fails to load (#787, ADR 0036), even on a connection no section uses. The `askdb.config:` error names the key and never repeats the URL: put the key in `apiKey`, and for other credentials, such as a proxy's, build the model in code with the AI SDK provider's `headers` option. Such a URL never worked, because `fetch` refuses it with an error that quotes the URL, credentials included.
- 1b9468d: **Breaking:** the runtime view's AI env maps are removed (#711). `getAskDbRuntimeConfig().ai.aiEnv`, `ai.language.env` and `ai.embedding.env` are gone, and the flat map (`rt.flat`, `flattenAskDbConfig()`, `defineConfig().entries`) no longer carries AI keys such as `ASKDB_AI_PROVIDER` or `OPENAI_API_KEY`. Pass the typed section to `@askdb/ai`'s new `*FromSection` methods instead: `resolveAiConfigFromSection(rt.ai.language)`, `createLanguageModelFromSection(rt.ai.language)`, `createEmbeddingModelFromSection(rt.ai.embedding)` and `resolveReasoningEffortFromSection(rt.ai.language.reasoning, "nlToSql")`.
  
  - **`rt.ai.language.connection` and `rt.ai.embedding.connection` are objects:** the connection's `name` (before, the whole value) and its settings, trimmed, with unset ones left out: `apiKey`, `apiKeySecondary` (the config's `secondaryApiKey`), `baseUrl`, `resourceName` and `apiVersion`. The new `AskDbRuntimeAiConnection` type describes it.
  - **`rt.ai.language.reasoning`** is the config's `ai.language.reasoning`.
  - Both sections are assignable to `@askdb/ai`'s `AiLanguageSection` and `AiEmbeddingSection`; neither package depends on the other.
  - **`rt.rag.embedder` is removed**, with its type `AskDbRuntimeRagEmbedderConfig`. It held the OpenAI embedder's key, base URL and model, and nothing in AskDB read it. It's now `undefined`: read `rt.ai.embedding` instead (`connection.apiKey`, `connection.baseUrl` and `model`), which carries the embedding model's settings for any provider.
  
  The upgrade guide shows each change before and after.
- 1b9468d: **Breaking:** the deprecated config keys and exports are removed before 1.0 (#765). Each key warned at load, naming its replacement, since 1.0.0-beta.13 (`rag.storeConfig.file.autoFlush` since 1.0.0-beta.16). A config that still sets one now fails to load with an `askdb.config:` error that names each such key and its replacement, and never its value. A key counts as set whatever its value, so one that reads an unset variable with `env("…")` fails too.
  
  - **Keys:** `ai.reasoning` (use `ai.language.reasoning`); `model` on an `ai.providerConfig` connection (`ai.language.model`); `modelFamily` on a connection (`ai.language.modelFamily`); `ai.providerConfig.custom`, unless a section's provider is `custom` (key the connection by its provider id); `rag.embedder: "openai"` and `"ai-sdk"` (`rag.embedder: "ai"` with `ai.embedding`); `rag.embedderConfig` (`ai.embedding` and a connection); `rag.storeConfig.pgvector.dimensions` (`ai.embedding.dimensions`); `rag.storeConfig.file.autoFlush` (remove it).
  - **Exports:** `DEFAULT_OPENAI_CHAT_MODEL`, `DEFAULT_ANTHROPIC_CHAT_MODEL`, `DEFAULT_GOOGLE_CHAT_MODEL` and `DEFAULT_GATEWAY_CHAT_MODEL` (use the `DEFAULT_*_LANGUAGE_MODEL` constant of the same provider); `DEFAULT_RAG_EMBEDDING_MODEL`; `defaultRagEmbeddingDimensions()`; and the types `OpenaiConfig`, `AzureConfig`, `FoundryConfig`, `AnthropicConfig`, `GoogleConfig`, `GatewayConfig` (use the `<Provider>Connection` types), `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `GatewayAiConfig` (use `AskDbAiConfig`) and `OpenaiRagEmbedderConfig`.
  - **`ASKDB_RAG_EMBEDDERS`** is `["mock", "ai"]`, and `AskDbRagEmbedder` narrows to match.
  - **`getAskDbRuntimeConfig().deprecations`** is empty, since no key is deprecated now; it stays for the next deprecation.
  
  The upgrade guide shows each removed key before and after.

### Patch Changes

- 1ccc8c8: A pgvector store without `rag.storeConfig.pgvector.databaseUrl` now fails with a hint that says a variable the config already reads there, such as the one `askdb init` wrote to `.env.example`, is unset or blank (#713). The example stays `databaseUrl: env("PGVECTOR_URL")`. Before, a project that `askdb init` set up got only that example, which named a different variable from the one its config reads.
- 3841e09: `askdb init --database sqlserver` and Studio's guided setup no longer put `Trust Server Certificate=True` in the `.env.example` hint for the SQL Server connection string (#803). That key turned the certificate check off in AskDB, and the `mssql` driver ignored it because of the spaces, so a hint copied into production trusted any certificate in AskDB but not in a host's own `mssql` pool. The hint now leaves the key out, so AskDB and `mssql` both check the certificate by default. A second comment line says to add `TrustServerCertificate=True;`, spelled without spaces so both read it, for a development server with a self-signed certificate such as the SQL Server Docker image. An `.env.example` that `init` already wrote isn't changed.

## 1.0.0-beta.18

### Minor Changes

- 0e5d542: `@askdb/config/scaffold` exports the package-manager helpers `askdb init` and Studio share (#711): `detectPackageManager`, `findNearestPackageJsonDir`, `isLikelyWorkspaceRoot`, `lockfilePackageManager`, `packageManagerAddArgs`, `supportedBuildApprovals`, `formatInstallCommand`, `packageManagerSpawnSpec`, and the `PackageManager` and `PackageManagerSpawnSpec` types. The `@askdb/config/scaffold` entry point is tooling for `askdb init` and Studio, and experimental like Studio: a minor release of `@askdb/config` may change it (ADR 0030). `detectPackageManager` reads an existing lockfile first, then the nearest `package.json`'s `packageManager` or `devEngines.packageManager` field, then `npm_config_user_agent`, and falls back to npm (#750).
- 4a83b61: `@askdb/config/scaffold` exports `planAskDbScaffold`, the planner `askdb init` and Studio's setup wizard share (#711). It takes a new project's answers (engine, connection variable or SQLite file, Prisma schema path, schema directory, `ai` block, RAG store, Studio execute) and the `@askdb/config` and `@askdb/prisma` specs to install, and returns the `askdb.config.ts` source, the `.env.example`, the env vars the config reads, and the packages to install. It's pure. It throws `AskDbScaffoldInputError`, whose `field` names the answer, for an env var name that isn't uppercase POSIX (`^[A-Z_][A-Z0-9_]*$`), a control character in a path, an unknown id or a missing answer. Also exported: `isAskDbScaffoldEnvName(name)`, the planner's env var name rule, and the `AskDbScaffoldAnswers`, `AskDbScaffoldPlan` and `ScaffoldValue` types. For a Prisma project the plan installs `ai` (the newest major `@askdb/core`'s peer accepts) and `zod` (core's range) next to `@askdb/prisma`, which Yarn Plug'n'Play needs (#760). The `@askdb/config/scaffold` entry point is experimental: a minor release of `@askdb/config` may change it (ADR 0030).

### Patch Changes

- 150a293: `@askdb/config` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: config resolution, the flat env map, `bootstrapAskDbEnv` and every `askdb.config: …` error give the same results as before. The JSDoc on `flattenAskDbConfig` and `env()` now says which flat-map keys are written with a default (`ASKDB_RAG_EMBEDDER`, `ASKDB_INTROSPECT_OUT`, and with pgvector the index strategy and the mock embedder's dimensions) and which stay out until the config sets them.
- a8cef1b: The JSDoc for `introspection.providerConfig.sqlite.file` no longer offers `:memory:` for an empty database (#712). Introspection opens the file read-only, which an in-memory database can't be, so the path must name an existing file. Behavior is unchanged.

## 1.0.0-beta.17

### Minor Changes

- 63d45cc: `@askdb/config` resolves each setting once (#711). One internal resolver checks, translates and defaults every `askdb.config` setting and writes its flat-map key in the same pass, so `defineConfig`'s flat map and `getAskDbRuntimeConfig()` agree. `getAskDbRuntimeConfig()` never reads a value back from a flat map.
  
  - **A boolean setting must be `true` or `false`.** `logging.logStdout` and `modes.omitSensitiveFromPrompt` now fail to load on any other value, as `studio.execute.enabled`, `studio.execute.useIntrospectionConnection` and `httpApi.allowSchemaOverride` already did. Before, `omitSensitiveFromPrompt: "false"` turned the setting on, because a non-empty string is truthy.
  - **A string setting must be a string, or `null` for unset.** Any other value fails to load with an error naming the key, `host.schemaJson`, `host.schemaPath` and `studio.listen.host` included. Before, `false` or `0` was ignored for a few keys, such as `logging.logFile`, and stopped the load with a `TypeError` that named no key for the rest.
  - **Load errors name config keys, never flat keys** such as `PORT`: a pgvector store without a URL names `rag.storeConfig.pgvector.databaseUrl`, not `ASKDB_PGVECTOR_URL`. An object or array value is described by its type, never printed.
  - **`AskDbRuntimeLoggingConfig.level` is `AskDbLogLevel | undefined` and `AskDbRuntimeModesConfig.askdbMode` is `AskDbModeV1 | undefined`,** not `string`.
  - **`setAskDbRuntimeForTests(config)` takes an `AskDbConfig`** and installs it as `bootstrapAskDbEnv()` installs a loaded file. It used to take `{ structured, flat }`.
  - **A store that another copy of `@askdb/config` installed resolves from its `structured` config,** as ADR 0005 asks; its `flat` map is never read. `getAskDbRuntimeConfig().flat` and `ai.aiEnv` are this copy's projection of that config.
  
  `flattenAskDbConfig` writes the same keys as before. The configuration reference and the beta.48 upgrade notes cover the type checks, the narrowed types and the test helper.

## 1.0.0-beta.16

### Minor Changes

- 3d9bc33: `@askdb/config` fixes three mismatches between the config type and the code that reads it, before the package goes to 1.0 (#676).
  
  - **`httpApi.listen.port`:** a value that reads as `NaN`, such as `Number(env("PORT"))` with `PORT` unset, counts as unset, so the server uses port 3000. Before, `NaN` reached `listen()` and the server failed to start with `ERR_SOCKET_BAD_PORT`. Any other value that isn't an integer from 0 to 65535, or a string holding one, now fails when the config loads, with `askdb.config: invalid httpApi.listen.port …`. A port given as a string becomes a number in `getAskDbRuntimeConfig().httpApi.listen.port`.
  - **`rag.storeConfig.file.autoFlush`** is deprecated. Nothing ever read it, because the file store writes its files after every change. A config that sets it now gets a `DeprecationWarning` (code `ASKDB_CONFIG_DEPRECATED`), and it's listed in `getAskDbRuntimeConfig().deprecations`.
  - **`DEFAULT_RAG_FILE_BASE_PATH` is removed.** Nothing read it, and its value, `./askdb/rag`, was never the file store's default: with `rag.storeConfig.file.basePath` unset, the CLI and Studio use `<schema dir>/schema`. `flattenAskDbConfig` no longer writes `ASKDB_RAG_FILE_BASE_PATH` when `basePath` is unset.
  
  The JSDoc in `AskDbConfig` now matches the code: `dialect` is inferred from the schema artifact's recorded provider, nothing reads `ASKDB_INTROSPECT_<ENGINE>_URL` from the environment, and `httpApi.listen.port` shows `Number(env("PORT") ?? 3000)`.
  
  The configuration reference and the beta.47 upgrade notes cover the port check, the removed export and the deprecated key.

## 1.0.0-beta.15

### Minor Changes

- ed7f35c: Remove public exports that nothing in AskDB calls and no page documents, before the 1.0 API freeze (#356, ADR 0031).
  
  **Upgrade notes (breaking):**
  
  - `@askdb/core`: `formatSchemaForPrompt(schema, options)` is removed. Call `formatSchemaForNlToSql(schema, options).ddl`, which returns the same string.
  - `@askdb/config`: `DEFAULT_LOCAL_POSTGRES_URL` is removed, with no replacement. Write your own local connection string.
  - `@askdb/enrich`: `hasAnyColumnDescribable`, `isEnumCandidate`, `parseListInput` and `formatList` are removed, with no replacement. In place of `parseListInput(value)`, use `value.split(",").map((s) => s.trim()).filter(Boolean)`; in place of `formatList(list)`, use `list?.join(", ") ?? ""`.
  
  Internal cleanup with no API change: core's tenant-policy loader drops two unused helpers, and Studio's web app drops the unused `Drawer` and `Panel` components, the Drawer CSS and four unused formatting helpers.

### Patch Changes

- 2234954: `askdb.config.mjs` and a plain `export default { … }` config now load, as the docs say (#264, #265). `bootstrapAskDbEnv()`, and so the `askdb` CLI, Studio and the HTTP API, loads every documented extension synchronously, `.mjs` included; the file can't use top-level `await`. A plain object goes through the same normalizing, checks and deprecation warnings as `defineConfig({ … })`, which stays the typed helper and still returns the projection.
  
  A config without its `ai` or `introspection` block now fails to load with an error that names the file and the missing block (`AskDB config at <path>: the config has no ai block; …`), instead of a bare `TypeError` (#626). Every `askdb.config: …` error raised while a file loads now names that file the same way; calling `defineConfig` directly keeps the `askdb.config:` prefix. A file with no default export, a default export that isn't a plain object (`null`, a string, a Promise), and top-level `await` each fail with an error that names the file and says what to change, instead of a misleading or bare one.

## 1.0.0-beta.14

### Minor Changes

- d9b88f8: New export `isAskDbRuntimeInitialized()`: it returns `true` once `bootstrapAskDbEnv()` has installed the runtime snapshot, so code that may run before or after its host's bootstrap can bootstrap only when it's needed (#280). `@askdb/http-api`'s `createAskDbHttpServer()` uses it.
  
  The runtime snapshot is now process-wide: it lives on `globalThis` under `Symbol.for("askdb.runtimeStore")` instead of in a module variable, so every copy of `@askdb/config` in a process sees the snapshot the host bootstrapped. Before, a host whose `@askdb/config` version differed from the one an app such as `@askdb/http-api` depends on had two separate snapshots, and the app saw none. Copies older than this release still keep their own.

## 1.0.0-beta.13

### Minor Changes

- e57c734: Fix AI adapter correctness bugs that the AI SDK silently ignored.
  
  **@askdb/ai-azure**: Embedding `dimensions`/`user` are now sent. They were wrapped under `providerOptions.azure`, but `@ai-sdk/azure` builds embeddings with `OpenAIEmbeddingModel`, which reads only `providerOptions.openai`, so they were dropped. `reasoningEffort` now also sets `forceReasoning: true`. The AI SDK decides whether a model can reason from the model id it was given, which on Azure is the deployment name. Without this flag, a deployment such as `askdb-reporting` backed by `modelFamily: "gpt-5"` silently lost its reasoning effort. The missing-resource error now names the config keys (`ai.providerConfig.azure.resourceName` / `baseUrl`) and gives the `AZURE_RESOURCE_NAME` env alternative.
  
  **@askdb/ai-google**: Embeddings use the non-deprecated `google.embedding()` and now honor `dimensions`, mapped to Gemini's `outputDimensionality`.
  
  **@askdb/ai-openai / @askdb/ai-azure**: Reasoning-model detection no longer treats `gpt-5-chat*` (non-reasoning chat models) as reasoning models. It now recognizes gpt-5 point releases and later majors (`gpt-5.1`, `gpt-6`, …). gpt-6 and later accept `low` through `max` but not `minimal`, so a `minimal` effort is sent as `low` for them. This covers Azure deployments with a custom name and `modelFamily: "gpt-6"`, where the SDK can't see the family and would otherwise send `minimal`.
  
  **@askdb/ai-anthropic**: Reasoning-model detection now follows `@ai-sdk/anthropic`'s capability table. Claude Sonnet 4.6, Opus 4.6+, and the 5.x models (Opus 5, Sonnet 5, Fable 5, …) get adaptive thinking (`thinking: { type: "adaptive" }` plus `effort`) instead of the manual `budgetTokens` form, which newer models reject. Claude Haiku 4.5 now gets extended thinking.
  
  **@askdb/ai**: `aiKeyMissingMessage` now lists Anthropic. `aiProviderMissingMessage` maps aliases to the package that owns them (for example, `foundry` points to `@askdb/ai-azure`). It no longer suggests a nonexistent `@askdb/ai-<name>` package for custom providers. `withEmbeddingProviderOptions` takes an optional fourth argument that maps the portable `dimensions`/`user` options to a provider's own setting names; `@askdb/ai-google` now uses it instead of its own wrapper.
  
  **@askdb/config**: `AzureConfig` / `FoundryConfig` gain `resourceName`, which is flattened to the key the Azure adapter reads. Before this, a config-only Azure setup couldn't supply a resource name and failed at startup. `ASKDB_AI_PROVIDERS` now includes `"anthropic"`. New `@askdb/config/scaffold` entry point for tools that write a new `askdb.config.ts`: `renderAskDbAiConfigScaffold` renders its `ai` block and lists the env vars it reads, and `askdb init` and Studio's setup wizard both use it. The main entry is unchanged apart from `resourceName` and `ASKDB_AI_PROVIDERS`.
  
  **askdb / @askdb/studio**: `askdb init --ai-provider azure|foundry` and Studio's setup wizard (Azure OpenAI or Foundry) scaffold `resourceName: env("AZURE_RESOURCE_NAME")` and list `AZURE_RESOURCE_NAME` in `.env.example`, so the generated config works out of the box. `askdb init`'s `.env.example` now puts a one-line comment above each AI variable, and lists the SQLite file variable (`SQLITE_FILE` or the `--sqlite-file` env name) when the config reads one. It now also lists `DATABASE_URL` for `--database prisma --studio-execute` and `ASKDB_PGVECTOR_URL` for `--rag-store pgvector` without `--pgvector-env`, both of which the config read but `.env.example` left out, and lists each variable once. `--sqlite-file` now treats only an env-name-shaped value (`UPPER_SNAKE_CASE`) as a variable; a relative path such as `data.db` or `../db/app.db` is written as a literal path instead of `env("data.db")`.
- 11e2457: Restructure the `ai` config into provider connections plus a section per model, and stop a RAG key from reaching the wrong provider (#345, #435).
  
  **@askdb/config**: `ai.providerConfig.<provider>` now holds provider connections only (keys, endpoints, Azure resources, API versions), as one object or a list of named connections. The model choice moves to two sections, each with an optional `provider` and `connection`: `ai.language` (`model`, `modelFamily`, `reasoning`) and `ai.embedding` (`model`, `dimensions`), which `rag.embedder: "ai"` uses. The embedding model can come from a different provider than the language model, so an Anthropic setup can embed with OpenAI, and one provider can have two connections, such as two Azure resources. `ai.embedding.model` is required with `rag.embedder: "ai"`: AskDB no longer picks an embedding model for you. AskDB assumes no vector width: `ai.embedding.dimensions` is optional for every model and only requests a size from the provider. Unset, AskDB uses the width the model returns, learned when an index is built, so the pgvector store no longer needs a width in the config. A custom provider's connection is keyed by its provider id. The runtime config gains `ai.language`, `ai.embedding` (each with an `env` map built from that section's connection only) and `deprecations`. `ai.aiEnv` and the flat map's language keys are unchanged. Its `ASKDB_RAG_EMBEDDER*` keys follow the new shape: `ASKDB_RAG_EMBEDDER` is `"ai"` for the old `"openai"` and `"ai-sdk"`, `ASKDB_RAG_EMBEDDER_DIMENSIONS` holds only a configured width (or, for the mock embedder with the pgvector store, its 64), and `ASKDB_RAG_EMBEDDER_API_KEY` and `_BASE_URL` are no longer written, since the embedding key lives on its connection.
  
  Existing configs keep loading, apart from the cases listed below. Each old key is translated at load and reported once per process as a Node `DeprecationWarning` (code `ASKDB_CONFIG_DEPRECATED`) naming the old and new location, never the value: `providerConfig.<provider>.model` and Azure's `modelFamily` move to `ai.language`, `ai.reasoning` to `ai.language.reasoning`, `providerConfig.custom` to `providerConfig.<provider id>`, `rag.embedder: "openai" | "ai-sdk"` and `rag.embedderConfig.openai` to `rag.embedder: "ai"` plus `ai.embedding`, and `rag.storeConfig.pgvector.dimensions` (with an AI embedder) to `ai.embedding.dimensions`. With `rag.embedder: "mock"`, `rag.storeConfig.pgvector.dimensions` gets the same warning, saying it's ignored: the mock embedder's vectors are always 64 wide, as Studio already assumed. The old keys and the deprecated type aliases (`OpenaiConfig`, `OpenaiAiConfig`, …, `OpenaiRagEmbedderConfig`, `defaultRagEmbeddingDimensions`) are removed at 1.0.
  
  The key leak is fixed. A `rag.embedderConfig.openai.apiKey` or `.baseUrl` now moves to a connection of the embedding model's provider, and only when that provider is `openai`, `azure`, `foundry` or `gateway`; before, Studio sent the OpenAI key to the language model's provider (for example Google). The `askdb-rag` CLI's embedder settings no longer fall back to `ASKDB_AI_API_KEY` or `ASKDB_AI_BASE_URL`, so a custom provider's key or the gateway's URL no longer reaches OpenAI.
  
  These old-shape configs loaded before and now fail to load, each with an error that says what to change:
  
  - a `rag.embedderConfig.openai.apiKey` or `.baseUrl` whose embedding model would come from a provider other than `openai`, `azure`, `foundry` or `gateway` (the leak above);
  - `rag.embedder: "ai-sdk"` with no embedding model on a provider other than `openai`, `azure` or `foundry`, which asked that provider for `text-embedding-3-small`;
  - `rag.embedder: "ai-sdk"` with Anthropic as the language model's provider, which never embedded, since Anthropic has no embeddings API;
  - `rag.embedderConfig.openai.dimension` and `rag.storeConfig.pgvector.dimensions` set to different widths, where the pgvector value used to win silently;
  - an old key set next to its replacement: `ai.reasoning` with `ai.language.reasoning`, `ai.providerConfig.custom` with `ai.providerConfig.<provider id>`, or `rag.embedderConfig` with `ai.embedding`.
  
  **@askdb/rag**: New `detectEmbeddingDimensions(embedder)` learns an embedder's vector width by embedding one short text, so hosts don't have to hard-code a width. `createPgvectorStore`'s `dimensions` is now optional: it's needed only to create the table (`setupSql()`, or `ensureSchema()` when the table doesn't exist yet). The store gains `tableDimensions()`, and `ensureSchema()` now refuses an existing table whose width differs from `dimensions` with a `PgvectorDimensionMismatchError` (exported, with `table`, `tableDimensions` and `dimensions`), instead of keeping it and letting inserts fail partway through indexing. `buildSchemaIndex` records the width of the vectors it wrote in the lock file's `dimensions`.
  
  **@askdb/ai**: `ProviderEnvSpec.defaultEmbeddingModel` is deprecated. When an env map names no embedding model, `openai`, `azure` and `gateway` still fall back to their default, now with a one-time `DeprecationWarning` (code `ASKDB_AI_DEFAULT_EMBEDDING_MODEL`); the fallback is removed at 1.0. Configs never reach it, since `ai.embedding.env` always names the model. The "no embedding model" error points at `ai.embedding.model`, and the gateway and Anthropic messages name `ai.embedding` instead of the old `rag` keys.
  
  **@askdb/studio**: RAG embeds through the `ai.embedding` section's connection only. Settings shows the active embedder, the workspace reports the configured language model instead of a hard-coded `gpt-4o-mini`, and a RAG failure names the section, provider, connection and model. Studio no longer assumes a vector width. With pgvector, the first index build asks the embedding model for its width (one short embedding call) and creates the table at that width; an existing table of another width is refused with a 409 before any chunk is embedded, and the message names the table and how to resolve it: drop it and build again, point `rag.storeConfig.pgvector.table` at a new table, or set `ai.embedding.dimensions` to the table's width. The status page no longer creates the table, and shows the width recorded at the last build. Index ids carry a width only when `ai.embedding.dimensions` sets one, so an existing index built without one shows as stale once: rebuild it, or, for an old-shape config, set the width the deprecation warning names to keep it. Setup writes the new shape.
  
  **askdb**: `askdb init` writes the model to `ai.language.model` and no longer writes `rag.embedderConfig: {}`.
- f506c14: - `@askdb/config`: new `isAskDbDebugEnabled()` export. It returns `true` when the `ASKDB_DEBUG` shell variable is `1` or `true` (case-insensitive), and reads `process.env` directly so binaries can use it when the config fails to load. The `askdb` CLI uses it to decide whether to print stack traces.
  - `@askdb/studio`: when `askdb.config.*` exists but fails to load, `askdb-studio` (and `askdb studio`) print `askdb-studio: warning: <path> could not be loaded, so Studio is ignoring it: <error>` and start without it, instead of starting silently. The setup wizard still never overwrites an existing config.
  - Docs: the CLI reference documents `--help`/`--version`, which commands work without a config, the missing-config message, and `ASKDB_DEBUG`; troubleshooting matches the real missing-config error and covers configs that fail to load.
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
- 9847a87: Add `DEFAULT_OPENAI_LANGUAGE_MODEL`, `DEFAULT_ANTHROPIC_LANGUAGE_MODEL`, `DEFAULT_GOOGLE_LANGUAGE_MODEL` and `DEFAULT_GATEWAY_LANGUAGE_MODEL`, matching the "language model" term used elsewhere. The `DEFAULT_*_CHAT_MODEL` exports remain as deprecated aliases with the same values and are removed at 1.0.
- 9021e54: Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
- 40e7fee: Raise the supported Node floor from `>=22.14` to `>=22.23.4` (`engines.node` in every published package). 22.23.4 is the current Node 22 LTS (October 2026 security releases). Hosts on Node 22.14 through 22.23.3 should upgrade to Node 22.23.4 or newer.
- 3ad781b: Make the `rag` block optional in `AskDbConfig` (#226).
  
  **@askdb/config**: `rag` may now be omitted, and omitting it means `{ embedder: "mock", store: "memory" }`, which writes only `ASKDB_RAG_EMBEDDER=mock`. A config that sets `ai.embedding` but has no `rag` block fails to load, with an error saying to add `rag: { embedder: "ai", … }`. Existing configs are unaffected and flatten to the same keys. Breaking for TypeScript: `AskDbConfig["rag"]` is now optional, so code reading `config.rag` or `getAskDbRuntimeConfig().structured.rag` needs a check. The runtime config gains `rag.store` and `rag.storeConfig`, defaulted when the block is omitted (`storeConfig` is `{}` when the block has none); read those instead.
  
  **@askdb/studio**: RAG reads the store from `getAskDbRuntimeConfig().rag`, so a config without a `rag` block opens RAG with the in-memory store and the mock embedder.
  
  **askdb**: `askdb rag` reads its store fallbacks from `getAskDbRuntimeConfig().rag`, so a config without a `rag` block runs on the in-memory store and the mock embedder.

### Patch Changes

- 0009bb1: Raise `dotenv` to `^18.0.4`. 17.4.2 (April 2026) was the last 17.x release, and dotenv's fixes now ship on 18.x only. `bootstrapAskDbEnv` loads `.env` files the same way, still quietly. dotenv 18 drops `.env.vault` support, so setting `DOTENV_KEY` no longer makes `bootstrapAskDbEnv` decrypt a `.env.vault` file.
- b01f9fc: Add two `httpApi` config keys for `@askdb/http-api`:
  
  - `httpApi.allowSchemaOverride` (default `false`) — accept per-request `schemaJson`. Must be a boolean: any other value, such as the string `"false"`, is rejected with a config error. Flattens to `ASKDB_HTTP_ALLOW_SCHEMA_OVERRIDE`.
  - `httpApi.requestTimeoutMs` (default `60000`; must be a positive integer no larger than `2147483647`, the Node timer maximum, whether set in config or as `ASKDB_HTTP_REQUEST_TIMEOUT_MS` in the flat runtime map) — model-call timeout per request. Flattens to `ASKDB_HTTP_REQUEST_TIMEOUT_MS`.
  
  Both are exposed on `getAskDbRuntimeConfig().httpApi`. `DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS` is exported.
- fa2e771: Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.

## 1.0.0-beta.12

### Minor Changes

- 5dbe2d6: **MySQL/MariaDB: introspect several databases at once.**

  **@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

  **@askdb/config**: New `introspection.schemas?: string[]`, the config equivalent of `askdb introspect --schemas`, for every provider (on MySQL/MariaDB, the databases to introspect). Runtime config exposes it as `introspection.schemas`.

  **askdb**: `askdb introspect` reads `introspection.schemas` from config for any engine; `--schemas` overrides it.

  **@askdb/studio**: Resync passes the configured schema list to the connector, so it matches `askdb introspect`.

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

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

## 1.0.0-beta.11

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

## 1.0.0-beta.10

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
