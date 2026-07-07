---
"@askdb/config": minor
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/rag": patch
---

**Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

**`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.
