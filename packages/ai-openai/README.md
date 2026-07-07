# `@askdb/ai-openai`

OpenAI provider adapter for `@askdb/ai`.

Pass the adapter to `createAskDb` — no direct `@askdb/ai` import needed:

```ts
import { createAskDb } from "@askdb/client";
import { openaiProvider } from "@askdb/ai-openai";

const askdb = createAskDb({ config, providers: [openaiProvider] });
```

Or build a standalone registry (advanced — e.g. to construct a model object outside the client):

```ts
import { createAiRegistry } from "@askdb/ai";
import { openaiProvider } from "@askdb/ai-openai";

const ai = createAiRegistry([openaiProvider]);
```

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
