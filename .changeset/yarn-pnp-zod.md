---
"askdb": patch
"@askdb/studio": patch
"@askdb/http-api": patch
---

Depend on `zod` (`^4.6.7`, the same range as `@askdb/core`), the peer that `ai` and the `@ai-sdk/*` packages require, so Yarn Plug'n'Play can resolve it (#748). `yarn dlx askdb` crashed at startup because these packages install `ai` without providing its `zod`. npm and pnpm already installed `zod` through `@askdb/core`, so they install nothing new.
