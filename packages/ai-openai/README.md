# `@askdb/ai-openai`

OpenAI provider adapter for AskDB.

Pass the adapter to `createAskDb` and AskDB constructs the OpenAI model from your `askdb.config.*`:

```ts
import { createAskDb } from "@askdb/client";
import { openaiProvider } from "@askdb/ai-openai";

const askdb = createAskDb({ config, providers: [openaiProvider] });
```

Advanced: build a standalone registry to construct a model object outside the client:

```ts
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";

const ai = createAiRegistry([openaiProvider]);
```

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
