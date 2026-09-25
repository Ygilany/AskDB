# `@askdb/ai-azure` (deprecated)

> **Deprecated.** The Azure OpenAI / Microsoft Foundry provider is now built into
> [`@askdb/ai`](https://github.com/Ygilany/AskDB/tree/main/packages/ai). This package only re-exports `azureProvider` from `@askdb/ai` so existing
> imports keep working. It will be removed before AskDB 1.0.

## Migrate

```bash
npm uninstall @askdb/ai-azure
npm install @askdb/ai @ai-sdk/azure
```

```ts
// Before
import { azureProvider } from "@askdb/ai-azure";
const askdb = createAskDb({ config, providers: [azureProvider] });

// After: every built-in provider is registered by default; ai.provider in
// askdb.config.* ("azure" or "foundry") picks this one, and @ai-sdk/azure is
// loaded on first use.
const askdb = createAskDb({ config });

// Or, restricted to Azure, from a standalone registry:
import { createAiRegistry } from "@askdb/ai";
const ai = createAiRegistry(["azure"]);
```

`azureProvider` is still exported from `@askdb/ai` if you want to pass the adapter object.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
