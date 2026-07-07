---
"@askdb/client": minor
"@askdb/studio": patch
---

**@askdb/client**: `createAskDb()` accepts a new `providers` option — pass the adapter(s) for your configured provider and the client builds the AI registry internally:

```ts
import { createAskDb } from "@askdb/client";
import { openaiProvider } from "@askdb/ai-openai";

const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  providers: [openaiProvider], // no more createAiRegistry boilerplate
});
```

You no longer import anything from `@askdb/ai` on the config-driven path — it is now a regular dependency of `@askdb/client` (previously a peer), so install commands drop it too. The existing `registry` option remains supported as the advanced alternative (e.g. sharing one registry across several clients); passing both, or neither, throws with a clear message. Non-breaking for existing `registry` callers.

**@askdb/studio**: the Playground "Get the code" panel emits the new `providers` style in its config-driven snippet.
