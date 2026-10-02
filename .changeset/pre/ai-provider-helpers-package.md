---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-azure": minor
"@askdb/ai-google": minor
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

`@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.
