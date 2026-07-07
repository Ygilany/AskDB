# `@askdb/ai-anthropic`

Anthropic Claude provider adapter for `@askdb/ai`.

Pass the adapter to `createAskDb` and AskDB constructs the Anthropic model from your `askdb.config.*`:

```ts
import { createAskDb } from "@askdb/client";
import { anthropicProvider } from "@askdb/ai-anthropic";

const askdb = createAskDb({ config, providers: [anthropicProvider] });
```

Advanced: build a standalone registry to construct a model object outside the client:

```ts
import { createAiRegistry } from "@askdb/ai";
import { anthropicProvider } from "@askdb/ai-anthropic";

const ai = createAiRegistry([anthropicProvider]);
```

**Note**: Anthropic does not provide an embeddings API. Configure a separate embedding provider (e.g. OpenAI) when using RAG with Anthropic for chat.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
