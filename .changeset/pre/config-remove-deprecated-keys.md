---
"@askdb/config": minor
---

**Breaking:** the deprecated config keys and exports are removed before 1.0 (#765). Each key warned at load, naming its replacement, since 1.0.0-beta.13 (`rag.storeConfig.file.autoFlush` since 1.0.0-beta.16). A config that still sets one now fails to load with an `askdb.config:` error that names each such key and its replacement, and never its value. A key counts as set whatever its value, so one that reads an unset variable with `env("…")` fails too.

- **Keys:** `ai.reasoning` (use `ai.language.reasoning`); `model` on an `ai.providerConfig` connection (`ai.language.model`); `modelFamily` on a connection (`ai.language.modelFamily`); `ai.providerConfig.custom`, unless a section's provider is `custom` (key the connection by its provider id); `rag.embedder: "openai"` and `"ai-sdk"` (`rag.embedder: "ai"` with `ai.embedding`); `rag.embedderConfig` (`ai.embedding` and a connection); `rag.storeConfig.pgvector.dimensions` (`ai.embedding.dimensions`); `rag.storeConfig.file.autoFlush` (remove it).
- **Exports:** `DEFAULT_OPENAI_CHAT_MODEL`, `DEFAULT_ANTHROPIC_CHAT_MODEL`, `DEFAULT_GOOGLE_CHAT_MODEL` and `DEFAULT_GATEWAY_CHAT_MODEL` (use the `DEFAULT_*_LANGUAGE_MODEL` constant of the same provider); `DEFAULT_RAG_EMBEDDING_MODEL`; `defaultRagEmbeddingDimensions()`; and the types `OpenaiConfig`, `AzureConfig`, `FoundryConfig`, `AnthropicConfig`, `GoogleConfig`, `GatewayConfig` (use the `<Provider>Connection` types), `OpenaiAiConfig`, `AzureAiConfig`, `FoundryAiConfig`, `AnthropicAiConfig`, `GoogleAiConfig`, `GatewayAiConfig` (use `AskDbAiConfig`) and `OpenaiRagEmbedderConfig`.
- **`ASKDB_RAG_EMBEDDERS`** is `["mock", "ai"]`, and `AskDbRagEmbedder` narrows to match.
- **`getAskDbRuntimeConfig().deprecations`** is empty, since no key is deprecated now; it stays for the next deprecation.

The upgrade guide shows each removed key before and after.
