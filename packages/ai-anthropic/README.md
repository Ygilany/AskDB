# `@askdb/ai-anthropic`

Anthropic Claude provider adapter for `@askdb/ai`.

```ts
import { createAiRegistry } from "@askdb/ai";
import { anthropicProvider } from "@askdb/ai-anthropic";

const ai = createAiRegistry([anthropicProvider]);
```

**Note**: Anthropic does not provide an embeddings API. Configure a separate embedding provider (e.g. OpenAI) when using RAG with Anthropic for chat.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
