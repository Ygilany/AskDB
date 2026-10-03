# @askdb/ai

## 0.1.0-beta.8

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

## 0.1.0-beta.7

### Patch Changes

- ab2150b: Bump dependencies: AI SDK (`ai` 7.0.113, `@ai-sdk/*` 4.0.x), zod 4.6, mysql2 3.24, pg 8.23, @prisma/internals 7.10, @inquirer/prompts 8.7, React 19.3 and Vite 8.3 for Studio, and vitest 5 across the workspace.
- 2787b21: Release packaging fixes:

  - Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
  - `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
  - Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
  - Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.

## 0.1.0-beta.6

### Minor Changes

- 1131e77: CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.

## 0.1.0-beta.5

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

## 0.1.0-beta.4

### Patch Changes

- 162c33b: Docs only: package READMEs now lead with the `createAskDb({ providers: [...] })` path — no direct `@askdb/ai` import — with the standalone `createAiRegistry` usage kept as the documented advanced alternative.

## 0.1.0-beta.3

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

- 96e6963: Add `withEmbeddingProviderOptions` helper to `@askdb/ai` and use it in the OpenAI and Azure adapters, eliminating the near-identical per-adapter middleware blocks. Deprecates `createOpenAiEmbedder` in `@askdb/rag` — use `createAiSdkEmbedder` with an `@askdb/ai-openai` model or the `@askdb/ai` registry instead; the helper will be removed in 1.0.

## 0.1.0-beta.2

### Patch Changes

- baf5ad8: Restore AI SDK 6 embedding compatibility and preserve RAG embedding options.
- baf5ad8: Refresh dependency ranges across the workspace.

## 0.1.0-beta.1

### Minor Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.
