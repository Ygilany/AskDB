---
"@askdb/config": minor
"@askdb/studio": patch
---

Make the `rag` block optional in `AskDbConfig` (#226).

**@askdb/config**: `rag` may now be omitted, and omitting it means `{ embedder: "mock", store: "memory" }`, which writes only `ASKDB_RAG_EMBEDDER=mock`. A config that sets `ai.embedding` but has no `rag` block fails to load, with an error saying to add `rag: { embedder: "ai", … }`. Existing configs are unaffected and flatten to the same keys. Breaking for TypeScript: `AskDbConfig["rag"]` is now optional, so code reading `config.rag` or `getAskDbRuntimeConfig().structured.rag` needs a check. The runtime config gains `rag.store` and `rag.storeConfig`, defaulted when the block is omitted; read those instead.

**@askdb/studio**: RAG reads the store from `getAskDbRuntimeConfig().rag`, so a config without a `rag` block opens RAG with the in-memory store and the mock embedder.
