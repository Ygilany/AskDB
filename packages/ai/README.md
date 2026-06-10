# `@askdb/ai`

AskDB AI provider registry and shared config helpers. This package resolves AskDB config/env maps
and dispatches to provider adapters such as `@askdb/ai-openai`.

`@askdb/core` stays BYO-model: it accepts a model and runs the NL-to-SQL pipeline. Use this package
only when you want AskDB's shared provider selection and env-key precedence.

## Install

```bash
pnpm add @askdb/ai
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

## Exports

- `createAiRegistry`
- `resolveAiConfig`
- `resolveEmbeddingConfig`
- `aiKeyMissingMessage`
- `aiProviderMissingMessage`

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
