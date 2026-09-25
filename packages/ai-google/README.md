# `@askdb/ai-google` (deprecated)

> **Deprecated.** The Google Gemini provider is now built into [`@askdb/ai`](../ai). This package
> only re-exports `googleProvider` from `@askdb/ai` so existing imports keep working. It will be
> removed before AskDB 1.0.

## Migrate

```bash
npm uninstall @askdb/ai-google
npm install @askdb/ai @ai-sdk/google
```

```ts
// Before
import { googleProvider } from "@askdb/ai-google";
const askdb = createAskDb({ config, providers: [googleProvider] });

// After: every built-in provider is registered by default; ai.provider in
// askdb.config.* picks one, and @ai-sdk/google is loaded on first use.
const askdb = createAskDb({ config });

// Or, restricted to Google, from a standalone registry:
import { createAiRegistry } from "@askdb/ai";
const ai = createAiRegistry(["google"]);
```

`googleProvider` is still exported from `@askdb/ai` if you want to pass the adapter object.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
