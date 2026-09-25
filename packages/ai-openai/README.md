# `@askdb/ai-openai` (deprecated)

> **Deprecated.** The OpenAI provider is now built into [`@askdb/ai`](https://github.com/Ygilany/AskDB/tree/main/packages/ai). This package only
> re-exports `openaiProvider` from `@askdb/ai` so existing imports keep working. It will be
> removed before AskDB 1.0.

## Migrate

```bash
npm uninstall @askdb/ai-openai
npm install @askdb/ai @ai-sdk/openai
```

```ts
// Before
import { openaiProvider } from "@askdb/ai-openai";
const askdb = createAskDb({ config, providers: [openaiProvider] });

// After: every built-in provider is registered by default; ai.provider in
// askdb.config.* picks one, and @ai-sdk/openai is loaded on first use.
const askdb = createAskDb({ config });

// Or, restricted to OpenAI, from a standalone registry:
import { createAiRegistry } from "@askdb/ai";
const ai = createAiRegistry(["openai"]);
```

`openaiProvider` is still exported from `@askdb/ai` if you want to pass the adapter object.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
