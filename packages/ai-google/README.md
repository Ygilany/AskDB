# `@askdb/ai-google`

Google Generative AI / Gemini provider adapter for `@askdb/ai`.

Pass the adapter to `createAskDb` and AskDB constructs the Google model from your `askdb.config.*`:

```ts
import { createAskDb } from "@askdb/client";
import { googleProvider } from "@askdb/ai-google";

const askdb = createAskDb({ config, providers: [googleProvider] });
```

Advanced: build a standalone registry to construct a model object outside the client:

```ts
import { createAiRegistry } from "@askdb/ai";
import { googleProvider } from "@askdb/ai-google";

const ai = createAiRegistry([googleProvider]);
```

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
