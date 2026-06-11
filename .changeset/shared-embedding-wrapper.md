---
"@askdb/ai": minor
"@askdb/ai-openai": patch
"@askdb/ai-azure": patch
"@askdb/rag": patch
---

Add `withEmbeddingProviderOptions` helper to `@askdb/ai` and use it in the OpenAI and Azure adapters, eliminating the near-identical per-adapter middleware blocks. Deprecates `createOpenAiEmbedder` in `@askdb/rag` — use `createAiSdkEmbedder` with an `@askdb/ai-openai` model or the `@askdb/ai` registry instead; the helper will be removed in 1.0.
