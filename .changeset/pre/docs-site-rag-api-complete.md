---
"@askdb/docs-site": patch
---

The `@askdb/rag` API reference now covers every export (#713). New entries: the chunker (`chunkSchema`, `chunkSchemaDir`, `chunkSchemaBundle`, `ChunkOptions`, `ChunkStats`, `ChunkerSources`, `DEFAULT_CHUNK_MAX_CHARS`), the lock file (`SchemaLockFile`, `readLockFile`, `writeLockFile`, `SCHEMA_LOCK_VERSION`, `chunkContentHash`, `IndexMatch`), the memory and file stores, `VectorStoreDescriptor`, `UpsertRecord`, `ChunkPayload`, the re-exported `synthesizeRetrievedDdl`, the embedder option types, and the `AskDbRagLogEvent` events. The page says `@askdb/rag` is 0.x (ADR 0030), lists the store and embedder entry points, and gives `createRetriever`'s default `k` of 8. Sizing advice and store recommendations stay in the RAG guide.
