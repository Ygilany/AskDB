# `@askdb/ai`

AskDB AI provider helpers. This package turns AskDB config/env maps into AI SDK language and
embedding models.

`@askdb/core` stays BYO-model: it accepts a model and runs the NL-to-SQL pipeline. Use this package
only when you want AskDB's shared provider selection and env-key precedence.

## Install

```bash
pnpm add @askdb/ai
# Plus the provider package you configure:
pnpm add @ai-sdk/openai
```

Provider packages are optional peers. Install only the provider your runtime uses.

## Usage

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAskDbLanguageModelFromEnv } from "@askdb/ai";
import { ask, loadSchema } from "@askdb/core";

bootstrapAskDbEnv({ cwd: process.cwd() });

const runtime = getAskDbRuntimeConfig();
const model = await createAskDbLanguageModelFromEnv(runtime.ai.aiEnv);

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

- `resolveAskDbAiConfig`
- `resolveAskDbEmbeddingConfig`
- `createAskDbLanguageModel`
- `createAskDbLanguageModelFromEnv`
- `createAskDbEmbeddingModel`
- `createAskDbEmbeddingModelFromEnv`
- `askDbAiKeyMissingMessage`

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
