# `@askdb/ai`

AskDB AI provider registry. It resolves AskDB config/env maps into AI SDK language and embedding models, with built-in providers for OpenAI, Azure OpenAI / Microsoft Foundry, Google Gemini, Anthropic, and the Vercel AI Gateway.

`@askdb/core` stays BYO-model: it accepts any AI SDK `LanguageModel` and runs the NL-to-SQL pipeline. Passing a model you built yourself (e.g. `openai("gpt-4o-mini")` from `@ai-sdk/openai`) straight to `ask()` is an equally supported path that needs no AskDB AI package. Use this package when you want `askdb.config.*` / env to pick the provider and model.

Most applications never import this package directly: `createAskDb({ config })` from `@askdb/client` registers every built-in provider and lets `ai.provider` in your config pick one. Import `@askdb/ai` yourself to construct model objects outside the client, to restrict or extend the provider set, or to share one registry across several clients.

## Install

```bash
pnpm add @askdb/ai ai
# Plus the AI SDK package for each provider you configure (optional peer dependencies):
pnpm add @ai-sdk/openai
```

| Provider (`ai.provider`) | Install | API key env var | Default language model |
|---|---|---|---|
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| `azure` (aliases `azure-openai`, `foundry`) | `@ai-sdk/azure` | `AZURE_OPENAI_API_KEY` | `gpt-4o-mini` (deployment name) |
| `gateway` (Vercel AI Gateway) | nothing: ships with `ai` | `AI_GATEWAY_API_KEY` | `openai/gpt-4o-mini` |

Embedding models have no default: `rag.embedder: "ai"` requires `ai.embedding.model`, the section path (`createEmbeddingModelFromSection`) requires a model, and so does an env map (`ASKDB_AI_EMBEDDING_MODEL` or the provider's embedding model variable). With an API key and no model, each throws.

Each built-in provider imports its SDK package lazily, the first time it builds a model, so registering all of them costs nothing. If the package isn't installed, model creation fails with: `Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`. The same data is exported as `BUILTIN_AI_PROVIDERS`.

## Usage

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry, resolveReasoningEffortFromSection } from "@askdb/ai";
import { ask, loadSchema } from "@askdb/core";

// No arguments: every built-in provider. Or restrict it: createAiRegistry(["openai"]).
const ai = createAiRegistry();

bootstrapAskDbEnv({ cwd: process.cwd() });

const runtime = getAskDbRuntimeConfig();
// The typed ai.language section from askdb.config.*; no env map in between.
const model = await ai.createLanguageModelFromSection(runtime.ai.language);

if (!model) throw new Error(ai.keyMissingMessage("NL-to-SQL"));

const schema = loadSchema("./askdb");

const result = await ask({
  question: "How many users signed up last week?",
  schema,
  dialect: "postgres",
  model,
});
```

### Without a config file

A host with no `askdb.config.*` passes an env map instead: `ai.createLanguageModelFromEnv(process.env)` reads `ASKDB_AI_PROVIDER` (default `openai`), then the API key, model and base URL from the `ASKDB_AI_*` variables first and the provider's own variables (`OPENAI_API_KEY`, …) after them. The [package reference](https://askdb.tools/reference/packages/#env-map-precedence) lists the precedence. The section and env paths give the same `AiConfig` for the same settings.

### Custom providers

`AiProviderAdapter` is the extension point for providers that aren't built in. Pass adapter objects alongside (or instead of) built-in names:

```ts
const ai = createAiRegistry(["openai", myMistralAdapter]);
```

Bundling: importing `@askdb/ai` reaches every built-in, and each loads its SDK with `import("@ai-sdk/<x>").catch(...)`. esbuild builds without the SDKs a host didn't install. webpack 5 reports `Module not found` for each missing one; install it or list it in `externals`.

## Reasoning/latency effort

`resolveProviderOptions` maps a provider-portable reasoning effort (`"minimal" | "low" | "medium" | "high"`) to each adapter's native `generateText` `providerOptions` — OpenAI/Azure `reasoningEffort`, Google `thinkingConfig` (`thinkingLevel` for Gemini 3.x, `thinkingBudget` for Gemini 2.5), Anthropic extended or adaptive `thinking`. It returns `undefined` when the effort is unset or the model doesn't support reasoning tuning. The `gateway` provider uses its upstream's mapping for `openai/`, `google/`, and `anthropic/` model ids and returns `undefined` for other upstreams.

```ts
const config = ai.resolveAiConfigFromSection(runtime.ai.language)!;
const model = await ai.createLanguageModel(config);
const reasoningEffort = resolveReasoningEffortFromSection(runtime.ai.language.reasoning, "nlToSql");
const providerOptions = reasoningEffort ? ai.resolveProviderOptions(config, { reasoningEffort }) : undefined;

await ask({ question, schema, dialect: "postgres", model, deps: { providerOptions } });
```

`resolveReasoningEffortFromSection(reasoning, purpose, override)` resolves the effective effort from an explicit override, the call purpose's own effort (`ai.language.reasoning.nlToSql` / `.enrichment`), then `ai.language.reasoning.effort`. Without a config file, `resolveReasoningEffort(env, purpose, override)` reads the same from `ASKDB_AI_REASONING_EFFORT_NL_TO_SQL` / `_ENRICHMENT`, then `ASKDB_AI_REASONING_EFFORT`. See the [config reference](https://askdb.tools/reference/config/#reasoning-effort).

## Exports

- `createAiRegistry`
- `BUILTIN_AI_PROVIDERS`, `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`
- the built-in adapters: `openaiProvider`, `azureProvider`, `googleProvider`, `anthropicProvider`, `gatewayProvider`
- `resolveBaseConfig`
- registry methods for a typed config section (`resolveAiConfigFromSection`, `resolveEmbeddingConfigFromSection`, `createLanguageModelFromSection`, `createEmbeddingModelFromSection`), for an env map (`resolveAiConfig`, `resolveEmbeddingConfig`, `createLanguageModelFromEnv`, `createEmbeddingModelFromEnv`), and `resolveProviderOptions`
- the section types `AiLanguageSection`, `AiEmbeddingSection`, `AiConnectionSection`, `AiReasoningSection`, and `AiModelSection` (what an adapter's optional `resolveConfigFromSection` reads)
- `aiKeyMissingMessage`
- `aiProviderMissingMessage`
- `AiBaseUrlCredentialsError`, thrown when a model base URL holds a username or password
- `resolveReasoningEffortFromSection`, `resolveReasoningEffort`, `isReasoningEffort`, `REASONING_EFFORTS`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
