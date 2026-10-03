# @askdb/client

## 1.0.0-beta.7

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

- e7ea657: Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
- Updated dependencies [e57c734]
- Updated dependencies [e7ea657]
- Updated dependencies [c6e289a]
- Updated dependencies [9021e54]
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
