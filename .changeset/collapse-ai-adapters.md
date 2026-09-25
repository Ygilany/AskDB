---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-azure": minor
"@askdb/ai-google": minor
"@askdb/ai-anthropic": minor
"@askdb/client": minor
"@askdb/config": minor
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

The OpenAI, Azure OpenAI / Foundry, Google, and Anthropic providers are now built into
`@askdb/ai`. The `@askdb/ai-*` packages are deprecated (ADR 0006 amendment, Option E).

**@askdb/ai**: ships the four providers (moved unchanged from `@askdb/ai-*`) plus a new
zero-dependency `gateway` provider for the Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model ids
like `openai/gpt-4o-mini`). Each provider loads its AI SDK package lazily, the first time it
builds a model. `@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/google`, and `@ai-sdk/anthropic`
are now **optional peer dependencies**: install the one for the provider you configure. If it's
missing, model creation fails with
`Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`.

- `createAiRegistry()` with no arguments registers every built-in provider. It also accepts
  built-in names and aliases (`createAiRegistry(["openai"])`), mixed freely with
  `AiProviderAdapter` objects. Custom adapters work unchanged.
- New exports: `BUILTIN_AI_PROVIDERS` (one table of names, aliases, env vars, default models,
  and SDK packages), `BUILTIN_AI_PROVIDER_NAMES`, `findBuiltinAiProvider`,
  `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`, `optionalPeerMissingMessage`,
  the adapters `openaiProvider` / `azureProvider` / `googleProvider` / `anthropicProvider` /
  `gatewayProvider`, and the `AiProviderSelector` type.
- `aiProviderMissingMessage` now says to pass the built-in name to `createAiRegistry()` and to
  install `@ai-sdk/<provider>`, instead of naming an `@askdb/ai-*` package.
  `aiKeyMissingMessage` also lists the gateway.
- The built-in adapters' `createLanguageModel` / `createEmbeddingModel` are now `async`. The
  `AiProviderAdapter` contract already allowed promises, and `AiRegistry` methods were already
  async.

**@askdb/ai-openai, @askdb/ai-azure, @askdb/ai-google, @askdb/ai-anthropic (deprecated)**: each
now only re-exports its adapter from `@askdb/ai`, which it depends on directly (it was a
peer). It keeps its `@ai-sdk/*` dependency, so existing installs and imports keep working.
These packages will be removed before 1.0. To migrate:

```diff
- npm i @askdb/ai-openai
+ npm i @askdb/ai @ai-sdk/openai

- import { openaiProvider } from "@askdb/ai-openai";
- const askdb = createAskDb({ config, providers: [openaiProvider] });
+ const askdb = createAskDb({ config }); // or providers: ["openai"]

- const ai = createAiRegistry([openaiProvider]);
+ const ai = createAiRegistry(["openai"]);
```

**@askdb/client**: `createAskDb({ config })` no longer throws when neither `providers` nor
`registry` is passed. It registers every built-in `@askdb/ai` provider, and `ai.provider` in
the config picks one. `providers` also accepts built-in names.

**@askdb/config**: new `ai.provider: "gateway"` branch (`providerConfig.gateway.{apiKey, baseUrl,
model}`, flattened to `AI_GATEWAY_API_KEY` / `ASKDB_AI_BASE_URL` / `ASKDB_AI_MODEL`).
`ASKDB_AI_PROVIDERS` includes `"gateway"`. `DEFAULT_ANTHROPIC_CHAT_MODEL`,
`DEFAULT_GOOGLE_CHAT_MODEL`, and `DEFAULT_GATEWAY_CHAT_MODEL` are now exported. A test in
`@askdb/ai` fails if this list or these defaults drift from the built-in provider table.

**askdb, @askdb/http-api, @askdb/studio**: register providers with `createAiRegistry()` and
depend on `@askdb/ai` plus all four `@ai-sdk/*` packages instead of `@askdb/ai-*`. They still
work from env/config alone. `askdb init` and Studio setup now take their provider choices and
scaffolded env var names from `@askdb/ai`'s table, and both offer the Vercel AI Gateway. Google
now scaffolds `GOOGLE_AI_MODEL`, the variable the provider actually reads, instead of
`GOOGLE_GENERATIVE_AI_MODEL`. Studio's "Get the code" snippet uses `@askdb/client` +
`@ai-sdk/<provider>`.
