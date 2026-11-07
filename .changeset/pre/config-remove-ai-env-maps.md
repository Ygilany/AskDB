---
"@askdb/config": minor
---

**Breaking:** the runtime view's AI env maps are removed (#711). `getAskDbRuntimeConfig().ai.aiEnv`, `ai.language.env` and `ai.embedding.env` are gone, and the flat map (`rt.flat`, `flattenAskDbConfig()`, `defineConfig().entries`) no longer carries AI keys such as `ASKDB_AI_PROVIDER` or `OPENAI_API_KEY`. Pass the typed section to `@askdb/ai`'s new `*FromSection` methods instead: `resolveAiConfigFromSection(rt.ai.language)`, `createLanguageModelFromSection(rt.ai.language)`, `createEmbeddingModelFromSection(rt.ai.embedding)` and `resolveReasoningEffortFromSection(rt.ai.language.reasoning, "nlToSql")`.

- **`rt.ai.language.connection` and `rt.ai.embedding.connection` are objects:** the connection's `name` (before, the whole value) and its settings, trimmed, with unset ones left out: `apiKey`, `apiKeySecondary` (the config's `secondaryApiKey`), `baseUrl`, `resourceName` and `apiVersion`. The new `AskDbRuntimeAiConnection` type describes it.
- **`rt.ai.language.reasoning`** is the config's `ai.language.reasoning`.
- Both sections are assignable to `@askdb/ai`'s `AiLanguageSection` and `AiEmbeddingSection`; neither package depends on the other.
- **`rt.rag.embedder` is removed**, with its type `AskDbRuntimeRagEmbedderConfig`. It held the OpenAI embedder's key, base URL and model, and nothing in AskDB read it. It's now `undefined`: read `rt.ai.embedding` instead (`connection.apiKey`, `connection.baseUrl` and `model`), which carries the embedding model's settings for any provider.

The upgrade guide shows each change before and after.
