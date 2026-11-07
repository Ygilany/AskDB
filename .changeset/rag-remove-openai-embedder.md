---
"@askdb/rag": minor
---

**Breaking:** `createOpenAiEmbedder` and `CreateOpenAiEmbedderOptions` are removed, and `@askdb/rag/embedders/openai` is no longer an entry point (#844). The helper was deprecated since `@askdb/rag` 0.2.0-beta.17 and promised for removal at 1.0; it also picked `text-embedding-3-small` when no model was set, which no other layer does (ADR 0016). Wrap a model with `createAiSdkEmbedder({ model })` instead: from `askdb.config.*`, build it with `@askdb/ai`'s `createAiRegistry().createEmbeddingModelFromSection(rt.ai.embedding)`; without a config file, use any AI SDK embedding model, such as `createOpenAI({ apiKey }).embedding("text-embedding-3-small")`. The helper's `dimensions` and `user` options become `providerOptions: { openai: { dimensions, user } }`. `askdb rag` and Studio users set `rag.embedder: "ai"` and `ai.embedding`. The upgrade guide's beta.50 section shows each.
