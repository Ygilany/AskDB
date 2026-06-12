# @askdb/rag

## 0.2.0-beta.17

### Patch Changes

- 96e6963: Add `withEmbeddingProviderOptions` helper to `@askdb/ai` and use it in the OpenAI and Azure adapters, eliminating the near-identical per-adapter middleware blocks. Deprecates `createOpenAiEmbedder` in `@askdb/rag` — use `createAiSdkEmbedder` with an `@askdb/ai-openai` model or the `@askdb/ai` registry instead; the helper will be removed in 1.0.
- Updated dependencies [d4a0a1d]
- Updated dependencies [c0603e1]
- Updated dependencies [0f0c481]
  - @askdb/config@1.0.0-beta.8

## 0.2.0-beta.16

### Patch Changes

- baf5ad8: Restore AI SDK 6 embedding compatibility and preserve RAG embedding options.
- baf5ad8: Refresh dependency ranges across the workspace.
- Updated dependencies [baf5ad8]
  - @askdb/core@1.0.0-beta.26

## 0.2.0-beta.15

### Patch Changes

- Updated dependencies [05a589a]
  - @askdb/config@1.0.0-beta.7

## 0.2.0-beta.14

### Patch Changes

- dda0abf: Persist ignored table metadata and keep ignored table references out of RAG concept and relationship chunks.
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21

## 0.2.0-beta.13

### Patch Changes

- Updated dependencies [bc8642f]
  - @askdb/core@1.0.0-beta.20

## 0.2.0-beta.12

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6

## 0.2.0-beta.11

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16

## 0.2.0-beta.9

### Minor Changes

- c3c0f21: Add Phase 10 multi-tenant isolation proof.

  `@askdb/core` gains a complete tenant isolation pipeline:
  - **Tenant policy format**: `tenant-policy.md` with YAML front-matter (roots, hierarchy, scoped tables, polymorphic mappings, global tables, enforcement mode) and markdown body for business context.
  - **Runtime `TenantScope`**: Unified scope input on `ask()` with four access kinds (`ids`, `subtree`, `multi_root`, `global`), optional `tenantFilters`, and advisory `context`. Fail-closed when policy exists but scope is missing.
  - **Prompt assembly**: Tenant policy block always injected into NL→SQL prompts (security boundary) with hierarchy, scoped table paths, named placeholders, and enforcement rules.
  - **SQL guardrails**: Heuristic validation checks scoped tables for tenant predicates, polymorphic tables for type discriminators, and unknown tables. Configurable `strict` (throw) vs `warn` (return warnings) enforcement.
  - **SQL output modes**: `tenantSqlMode` option — `"sql-only"` (default) inlines literal values with `=` → `IN` rewriting; `"sql-params"` converts to positional `$N` parameters. Result includes `tenantBindings` and `tenantParams`.
  - **Schema evolution**: New tables classified as `unknown`; orphaned table/column/FK references flagged as warnings.

  `@askdb/rag` adds `"tenant-policy"` as a chunk type. The chunker emits one chunk per H2 section from `tenant-policy.md` body. Source loaders (directory and bundle) now load tenant policy. `synthesizeRetrievedDdl` includes retrieved tenant policy context in focused prompts.

### Patch Changes

- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14

## 0.2.0-beta.8

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5

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
