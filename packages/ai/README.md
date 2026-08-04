# `@askdb/ai`

AskDB AI provider registry and shared config helpers. This package resolves AskDB config/env maps
and dispatches to provider adapters such as `@askdb/ai-openai`.

`@askdb/core` stays BYO-model: it accepts a model and runs the NL-to-SQL pipeline. Use this package
only when you want AskDB's shared provider selection and env-key precedence.

Most applications never import this package directly: `createAskDb` from `@askdb/client` accepts
`providers: [openaiProvider]` and builds the registry internally. Import `@askdb/ai` yourself only
to construct model objects outside the client or to share one registry across several clients.

## Install

```bash
pnpm add @askdb/ai ai
# Plus the AskDB provider adapter you configure:
pnpm add @askdb/ai-openai
```

Install only the provider adapter packages your runtime uses.

## Usage

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";
import { ask, loadSchema } from "@askdb/core";

const ai = createAiRegistry([openaiProvider]);

bootstrapAskDbEnv({ cwd: process.cwd() });

const runtime = getAskDbRuntimeConfig();
const model = await ai.createLanguageModelFromEnv(runtime.ai.aiEnv);

if (!model) throw new Error("No AI key configured.");

const schema = loadSchema("./askdb");

const result = await ask({
  question: "How many users signed up last week?",
  schema,
  dialect: "postgres",
  model,
});
```

## Reasoning/latency effort

`resolveProviderOptions` maps a provider-portable reasoning effort
(`"minimal" | "low" | "medium" | "high"`) to each adapter's native
`generateText` `providerOptions` — OpenAI/Azure `reasoningEffort`, Google
`thinkingConfig` (`thinkingLevel` for Gemini 3.x, `thinkingBudget` for Gemini
2.5), Anthropic extended `thinking`. It returns `undefined` when the effort is
unset or the model doesn't support reasoning tuning.

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
- `resolveBaseConfig`
- registry methods such as `resolveAiConfig`, `resolveEmbeddingConfig`,
  `createLanguageModelFromEnv`, `createEmbeddingModelFromEnv`, and
  `resolveProviderOptions`
- `aiKeyMissingMessage`
- `aiProviderMissingMessage`
- `resolveReasoningEffort`, `isReasoningEffort`, `REASONING_EFFORTS`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
