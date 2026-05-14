# Phase 8 — RAG layer (`@askdb/rag`) (requirements)

Status: Not reviewed

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

Phase 5 introduces the describable schema (Schema v2) in `@askdb/core` — table descriptions, aliases, "common query language", example questions, optional concepts ([`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)). Phase 6 produces v2 directories from real databases via `@askdb/introspect`. Phase 7 enriches them via `@askdb/tui`. For small schemas all of this fits in a prompt and `@askdb/core` already inlines it. For real-world schemas (50+ tables, hundreds of columns), it doesn't.

Phase 8 adds **retrieval over the v2 artifact**: deterministic chunking, BYO embedder, BYO vector store, and an optional retriever wired into `ask()`. The retriever doesn't replace prompt assembly — it picks **which** chunks of the v2 artifact go into the prompt's DDL block.

This phase is the deliverable of the original RAG phase from the pre-pivot roadmap, pulled forward to land before the web catalog and additional database engines.

## Problem

Without Phase 8:

- **Large schemas blow up prompts** — inlining 200-column DDL plus descriptions plus "common query language" plus example questions can hit context limits or just degrade NL→SQL quality.
- **The high-value parts of the v2 artifact are wasted at scale** — "sales = paid orders" lives in `orders.md`, but if `orders` isn't in the prompt window, the model never sees it.
- **No vocabulary bridge** — concepts (`customer` → `users` + `leads`) only help if a retriever can match user phrasing to the concept.
- **The RAG layer is currently hardcoded to a future vendor decision** — without an interface, a hasty pgvector dependency would lock everyone in.

## Scope (in)

### 1) `@askdb/rag` package

A new workspace package: `packages/rag/`, published as `@askdb/rag`, exporting a small public surface focused on three things — chunking, indexing, retrieving.

### 2) Deterministic chunker

Implements [Chunking rules](../../contracts/schema-v2.md#chunking-rules) from the contract:

- Reads a v2 artifact (directory or bundled JSON) via `@askdb/core`'s loader.
- Produces a deterministic list of chunks with stable `id`s and stable `text`s.
- Chunk types: `table`, `column`, `cql` (common query language), `question`, `concept`, optional `relationship`.
- Honors **size guidance** — long bodies split on paragraph boundaries with stable suffixes.
- Honors **sensitive propagation** — see "Sensitive propagation" below.

**Determinism is a contract:** given the same v2 artifact, the chunker produces the same chunk ids and texts on every run, regardless of file system ordering, OS, or Node version. Tests enforce this.

### 3) `Embedder` interface (BYO)

```ts
export type Embedder = (texts: string[]) => Promise<number[][]>;
```

- One function, batched by the caller. No model-specific concerns leak into `@askdb/rag`.
- Reference implementation in `@askdb/rag/embedders/openai` (or a doc snippet) using AI SDK `embedMany` with `text-embedding-3-small`. Optional dependency, not required.
- Other reference snippets in docs: AI Gateway, Cohere, Voyage, local (Ollama/Transformers.js).

### 4) `VectorStore` interface (BYO)

```ts
export type ChunkPayload = {
  id: string;
  type: "table" | "column" | "cql" | "question" | "concept" | "relationship";
  text: string;
  schemaId: string;
  refs: string[];               // schema-v2 ids this chunk references (for cross-linking)
  sensitive: boolean;           // pre-filtered; here as metadata for telemetry
};

export type Filter = {
  schemaId?: string;
  types?: ChunkPayload["type"][];
  refs?: string[];              // limit to chunks referencing these v2 ids
};

export type VectorStore = {
  upsert(records: { id: string; vector: number[]; payload: ChunkPayload }[]): Promise<void>;
  query(vector: number[], k: number, filter?: Filter): Promise<{ id: string; score: number; payload: ChunkPayload }[]>;
  delete(ids: string[]): Promise<void>;
  /** Optional — if implemented, used to skip re-embedding unchanged chunks. */
  hashesByPrefix?(prefix: string): Promise<Record<string, string>>;
};
```

Adapters shipped in this phase, in this order:

1. **In-memory** (`@askdb/rag/stores/memory`) — cosine over `Float32Array`, zero deps. Default for tests and small schemas. Always available.
2. **File-backed** (`@askdb/rag/stores/file`) — embeddings serialized as `<schemaId>.embeddings.bin` next to the schema artifact, plus `schema.lock.json` with per-chunk content hashes. Checked-in or shipped artifact.
3. **pgvector** (`@askdb/rag/stores/pgvector`) — most likely production target. Optional dependency on `pg`; `CREATE EXTENSION` instructions documented but not auto-run.

Other adapters (lancedb, sqlite-vss, Pinecone, Weaviate) deferred to follow-on work; the interface stays the same.

### 5) Indexer

```ts
export async function buildSchemaIndex({
  schema,             // result of @askdb/core loadSchema
  embedder,
  store,
  options?: {
    includeSensitiveDescribable?: boolean;  // default false
    chunkSizeMaxTokens?: number;            // default 250
    onProgress?: (e: IndexProgressEvent) => void;
  },
}): Promise<{
  retriever: Retriever;
  stats: { chunksIndexed: number; chunksReused: number; sensitiveExcluded: number; };
}>;
```

- Uses `schema.lock.json` (when available) to skip re-embedding chunks whose content hash hasn't changed.
- Logs structured events consistent with Phase 2 (`event`, `correlationId`, etc.) — fields prefixed `askdb.rag.*`.

### 6) `Retriever` and `ask()` wiring

```ts
export type Retriever = (params: {
  question: string;
  k?: number;             // default decided in implementation, e.g. 8
  filter?: Filter;
}) => Promise<{ id: string; score: number; payload: ChunkPayload }[]>;
```

- `@askdb/core` `ask({ retriever })` becomes optional. When supplied:
  - The retriever is called with the user question; top-k chunks are returned.
  - Prompt assembly **replaces the full DDL block** with a focused DDL synthesized from the retrieved chunks (table chunks expand to full column lists for completeness; column chunks attach descriptions; cql/question/concept chunks attach as labeled context).
  - When **not** supplied, the Phase 5 behavior is preserved (full DDL inlined when v2 fields exist).
- A small **schema-size threshold** (decided in implementation) lets `@askdb/core` skip RAG even when a retriever is supplied if the full schema fits comfortably — measured in chunk count, not tokens (token measurement requires a tokenizer the core shouldn't depend on).

### 7) Sensitive propagation

Per [`schema-v2.md`](../../contracts/schema-v2.md#sensitive-propagation):

- **Default:** chunker excludes chunks whose source content references a sensitive column's description, aliases, enum, or `Common query language` text. Identifier + type still appear in prompts via `@askdb/core`'s NL→SQL DDL (existing behavior, unchanged).
- **Opt-in `includeSensitiveDescribable: true`** flips the default; `@askdb/rag` emits a structured warning event so operators see the policy change.
- **Logs:** counts only — `askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`. Never log identifiers or values.

### 8) Documentation and fixtures

- `packages/rag/README.md` with quickstart for each adapter.
- `docs/integration/rag-recipes.md`: BYO embedder snippets (OpenAI, AI Gateway, Cohere, Voyage, Ollama); BYO store snippets (in-memory, file-backed, pgvector).
- A **chunked-fixture snapshot** under `fixtures/schemas/orders-users.schema/.chunks.golden.json` so tests assert deterministic output.

## Out of scope

- **Reranking / hybrid search / lexical-pull** — pure dense retrieval for v0; reranking is a clean extension behind the same `Retriever` shape later.
- **Embeddings for raw row data** — Phase 8 chunks the **describable schema** only. `bounded_results` data → model is a separate contract (Phase 12) with stripping rules already documented.
- **Lancedb / sqlite-vss / Pinecone / Weaviate adapters** — interface is in scope; specific adapters are deferred.
- **Multi-modal / image embeddings** — text only.
- **Tokenizer in core** — chunk size guidance is character-based with documented assumptions; precise token counting belongs to consumers (or an opt-in helper later).
- **Auto-embedding inside `ask()`** — the consumer must explicitly call `buildSchemaIndex` and pass the returned retriever. No magic.

## Spec decisions (from planning)

| Topic | Decision |
|---|---|
| Chunker determinism | **Contract.** Tests enforce stable ids and texts across runs. |
| Embedder interface | **`(texts) => Promise<number[][]>`** — single function, BYO. |
| Vector store interface | Small `upsert` / `query` / `delete` (+ optional `hashesByPrefix` for skip-reembed). |
| First-party adapters | **In-memory → file-backed → pgvector**, in that order. Others deferred. |
| `Retriever` wiring | `ask({ retriever })` is **optional**; when supplied, replaces the inlined DDL block with synthesized retrieved DDL. |
| Sensitive default | **Exclude** describable-layer chunks for sensitive columns; opt-in to include. |
| Logs | Counts only — no identifiers or values in `askdb.rag.*` events. |
| Lock file | `schema.lock.json` next to the artifact; tracks per-chunk content hashes for skip-reembed. Optional but recommended. |
| Top-k default | **Decided in implementation** (e.g. 8 chunks) after benchmarking on the Pagila-sized fixture. |

## Open choices (to resolve during implementation)

- **Default top-k** — bench on Pagila + the v2 fixture; pick a value that consistently keeps prompts under a documented token ceiling for `gpt-4o-mini`.
- **Schema-size threshold for auto-skipping retrieval** — chunk-count threshold above which retrieval is recommended; below which full inlining is fine.
- **`schema.lock.json` schema** — exact format (per-chunk hash, optional embedded vector dimensions, embedder model id for invalidation).
- **pgvector index strategy** — IVFFlat vs. HNSW defaults; whether the adapter creates the index or expects the user to.
- **Synthesized DDL block format** — when retrieved chunks come back, exactly how to lay them out for the model. Likely "TABLE chunks first (with full column definitions), then `Column notes` from column chunks, then `Common query language` from cql chunks, then concepts, then example questions as system context."
- **Whether `@askdb/rag` ships a `Retriever` for hosts that already have an external vector index** — an "adapter-only" entrypoint (e.g. `createRetrieverFromStore(store, embedder)`) that doesn't need `buildSchemaIndex` to have run inside the host.

## Success (product)

After Phase 8:

1. A consumer with a 100+ table v2 schema runs `pnpm dlx @askdb/rag index <schema-dir>` (or the library equivalent), gets a `<schemaId>.embeddings.bin` + `schema.lock.json`, and passes the resulting retriever to `ask()` — NL→SQL prompts now contain a focused, retrieved DDL block instead of the full schema.
2. Aliases and "common query language" actually ground NL→SQL because the retriever surfaces those chunks for relevant questions.
3. Sensitive columns' describable-layer fields are absent from embeddings by default; turning `includeSensitiveDescribable: true` is observable in logs (counts only).
4. A consumer can plug a custom embedder (Cohere, Voyage, Ollama, etc.) and a custom vector store (their own pgvector instance, an external index, etc.) without modifying `@askdb/rag` source.
5. Re-running the indexer on an unchanged artifact is a near-no-op (chunks reused via lock file); changing one description re-embeds only the affected chunks.

## References

- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format + chunking + sensitive rules
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — Phase 8 does not change mode boundaries
- [`docs/mission.md`](../../mission.md) — RAG part of the package, BYO embedder + store
- [`docs/platform.md`](../../platform.md) — package layout, BYO seams
- [`docs/roadmap.md`](../../roadmap.md) — Phase 8
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 reader/writer this phase consumes
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — produces the v2 directories this phase chunks
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — enriches the describable layer this phase chunks
