# `@askdb/ai`

AskDB AI provider registry. It resolves AskDB config/env maps into AI SDK language and embedding
models, with built-in providers for OpenAI, Azure OpenAI / Microsoft Foundry, Google Gemini,
Anthropic, and the Vercel AI Gateway.

`@askdb/core` stays BYO-model: it accepts any AI SDK `LanguageModel` and runs the NL-to-SQL
pipeline. Passing a model you built yourself (e.g. `openai("gpt-4o-mini")` from `@ai-sdk/openai`)
straight to `ask()` is an equally supported path that needs no AskDB AI package. Use this package
when you want `askdb.config.*` / env to pick the provider and model.

Most applications never import this package directly: `createAskDb({ config })` from
`@askdb/client` registers every built-in provider and lets `ai.provider` in your config pick one.
Import `@askdb/ai` yourself to construct model objects outside the client, to restrict or extend
the provider set, or to share one registry across several clients.

## Install

```bash
pnpm add @askdb/ai ai
# Plus the AI SDK package for each provider you configure (optional peer dependencies):
pnpm add @ai-sdk/openai
```

| Provider (`ai.provider`) | Install | API key env var | Default model |
|---|---|---|---|
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `google` | `@ai-sdk/google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` |
| `azure` (aliases `azure-openai`, `foundry`) | `@ai-sdk/azure` | `AZURE_OPENAI_API_KEY` | `gpt-4o-mini` (deployment name) |
| `gateway` (Vercel AI Gateway) | nothing: ships with `ai` | `AI_GATEWAY_API_KEY` | `openai/gpt-4o-mini` |

Each built-in provider imports its SDK package lazily, the first time it builds a model, so
registering all of them costs nothing. If the package isn't installed, model creation fails with:
`Provider 'google' requires the optional peer dependency @ai-sdk/google. Install it: npm i @ai-sdk/google`.
The same data is exported as `BUILTIN_AI_PROVIDERS`.

> The `@askdb/ai-openai`, `@askdb/ai-azure`, `@askdb/ai-google`, and `@askdb/ai-anthropic`
> packages are deprecated re-export shims of these built-ins and will be removed before 1.0.

## Usage

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { ask, loadSchema } from "@askdb/core";

// No arguments: every built-in provider. Or restrict it: createAiRegistry(["openai"]).
const ai = createAiRegistry();

bootstrapAskDbEnv({ cwd: process.cwd() });

const runtime = getAskDbRuntimeConfig();
const model = await ai.createLanguageModelFromEnv(runtime.ai.aiEnv);

if (!model) throw new Error(ai.keyMissingMessage("NL-to-SQL"));

const schema = loadSchema("./askdb");

const result = await ask({
  question: "How many users signed up last week?",
  schema,
  dialect: "postgres",
  model,
});
```

### Custom providers

`AiProviderAdapter` is the extension point for providers that aren't built in. Pass adapter
objects alongside (or instead of) built-in names:

```ts
const ai = createAiRegistry(["openai", myMistralAdapter]);
```

Passing adapter objects is also the bundler-friendly option: the built-ins use dynamic
`import()` of optional peers, which some bundlers warn about when a peer isn't installed.

## Reasoning/latency effort

`resolveProviderOptions` maps a provider-portable reasoning effort
(`"minimal" | "low" | "medium" | "high"`) to each adapter's native
`generateText` `providerOptions` — OpenAI/Azure `reasoningEffort`, Google
`thinkingConfig` (`thinkingLevel` for Gemini 3.x, `thinkingBudget` for Gemini
2.5), Anthropic extended or adaptive `thinking`. It returns `undefined` when the effort is
unset or the model doesn't support reasoning tuning. The `gateway` provider doesn't map
reasoning effort yet, so it always returns `undefined`.

```ts
const config = ai.resolveAiConfig(runtime.ai.aiEnv)!;
const model = await ai.createLanguageModel(config);
const providerOptions = ai.resolveProviderOptions(config, { reasoningEffort: "low" });

await ask({ question, schema, dialect: "postgres", model, deps: { providerOptions } });
```

`resolveReasoningEffort(env, purpose, override)` resolves the effective effort
from an explicit override, a call-site env var (`ASKDB_AI_REASONING_EFFORT_NL_TO_SQL`
/ `_ENRICHMENT`), then the global `ASKDB_AI_REASONING_EFFORT` — set from
`askdb.config.ts`'s `ai.reasoning` block by `@askdb/config`. See the
[config reference](../../apps/docs-site/src/content/docs/reference/config.mdx#ai-reasoning--reasoninglatency-effort).

## Exports

- `createAiRegistry`
- `BUILTIN_AI_PROVIDERS`, `BUILTIN_AI_PROVIDER_NAMES`, `findBuiltinAiProvider`,
  `getBuiltinAiProviderSetup`, `listBuiltinAiProviderSetups`
- the built-in adapters: `openaiProvider`, `azureProvider`, `googleProvider`,
  `anthropicProvider`, `gatewayProvider`
- `resolveBaseConfig`
- registry methods such as `resolveAiConfig`, `resolveEmbeddingConfig`,
  `createLanguageModelFromEnv`, `createEmbeddingModelFromEnv`, and
  `resolveProviderOptions`
- `aiKeyMissingMessage`
- `aiProviderMissingMessage`, `optionalPeerMissingMessage`
- `resolveReasoningEffort`, `isReasoningEffort`, `REASONING_EFFORTS`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
