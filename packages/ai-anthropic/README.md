# `@askdb/ai-anthropic` (deprecated)

> **Deprecated.** The Anthropic provider is now built into [`@askdb/ai`](../ai). This package
> only re-exports `anthropicProvider` from `@askdb/ai` so existing imports keep working. It will
> be removed before AskDB 1.0.

## Migrate

```bash
npm uninstall @askdb/ai-anthropic
npm install @askdb/ai @ai-sdk/anthropic
```

```ts
// Before
import { anthropicProvider } from "@askdb/ai-anthropic";
const askdb = createAskDb({ config, providers: [anthropicProvider] });

// After: every built-in provider is registered by default; ai.provider in
// askdb.config.* picks one, and @ai-sdk/anthropic is loaded on first use.
const askdb = createAskDb({ config });

// Or, restricted to Anthropic, from a standalone registry:
import { createAiRegistry } from "@askdb/ai";
const ai = createAiRegistry(["anthropic"]);
```

`anthropicProvider` is still exported from `@askdb/ai` if you want to pass the adapter object.
Anthropic has no embeddings API; configure a separate embedding provider (e.g. OpenAI) for RAG.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
