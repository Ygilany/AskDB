---
"@askdb/rag": minor
---

Re-export all stores and embedders from the `@askdb/rag` root entry point. Consumers can now import `createMemoryStore`, `createFileStore`, `createPgvectorStore`, `createAiSdkEmbedder`, and `createOpenAiEmbedder` directly from `@askdb/rag` without using sub-path imports. Sub-path imports (`@askdb/rag/stores/memory`, `@askdb/rag/embedders/ai-sdk`, etc.) remain available and point to the same modules.
