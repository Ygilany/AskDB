# @askdb/rag

## 0.2.0-beta.7

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12

## 0.2.0-beta.6

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10

## 0.2.0-beta.5

### Patch Changes

- 0084012: Add `ensureSchema()` to the pgvector adapter and auto-invoke it in Studio on every RAG operation, eliminating the "relation does not exist" error when pgvector is configured. Add `askdb-rag setup-store` CLI command for explicit schema provisioning in CI and production pipelines.

## 0.2.0-beta.4

### Minor Changes

- 0f9a8a9: Re-export all stores and embedders from the `@askdb/rag` root entry point. Consumers can now import `createMemoryStore`, `createFileStore`, `createPgvectorStore`, `createAiSdkEmbedder`, and `createOpenAiEmbedder` directly from `@askdb/rag` without using sub-path imports. Sub-path imports (`@askdb/rag/stores/memory`, `@askdb/rag/embedders/ai-sdk`, etc.) remain available and point to the same modules.

## 0.2.0-beta.3

### Patch Changes

- 52cfa58: Honor the configured `rag.store` branch in Studio RAG flows and expose pgvector store metadata in Studio status.

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/core@0.5.0-beta.4

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- b018d88: Add the Phase 8 RAG layer.

  `@askdb/rag` ships deterministic Schema v2 chunking, BYO embedder and vector store interfaces, in-memory/file/pgvector stores, lock-file based index reuse, and the `askdb-rag` CLI.

  `@askdb/core` now accepts an optional `retriever` in `ask()`. When retrieval is used, core synthesizes a focused DDL block from retrieved schema chunks; without a retriever the existing full-DDL prompt path is preserved.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- daa2625: Surface AI SDK token usage in Studio for RAG indexing, RAG queries, and sample SQL generation.
- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [25980e4]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
  - @askdb/core@0.5.0-beta.0
  - @askdb/config@0.3.0-beta.0
