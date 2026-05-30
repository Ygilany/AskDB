---
"@askdb/ai": minor
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/tui": patch
---

Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` package.

`@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should import those helpers from `@askdb/ai`.
