# `@askdb/ai-azure`

Azure OpenAI / Microsoft Foundry provider adapter for `@askdb/ai`.

Pass the adapter to `createAskDb` and AskDB constructs the Azure OpenAI model from your `askdb.config.*`:

```ts
import { createAskDb } from "@askdb/client";
import { azureProvider } from "@askdb/ai-azure";

const askdb = createAskDb({ config, providers: [azureProvider] });
```

Advanced: build a standalone registry to construct a model object outside the client:

```ts
import { createAiRegistry } from "@askdb/ai";
import { azureProvider } from "@askdb/ai-azure";

const ai = createAiRegistry([azureProvider]);
```

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
