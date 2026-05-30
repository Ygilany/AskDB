# Feature: RAG Layer

**Status:** Complete  
**Packages:** `@askdb/rag`

## Overview

The RAG layer adds retrieval over the Schema v2 describable artifact so large schemas don't blow up the NL→SQL prompt. For small schemas, `ask()` inlines the full DDL block. For large schemas (50+ tables, hundreds of columns), a retriever selects the most relevant chunks for the question and uses those in place of the full DDL.

`@askdb/rag` provides: a deterministic chunker that segments a Schema v2 artifact into typed chunks, a BYO embedder interface, BYO vector store interface with three built-in adapters (in-memory, file-backed, pgvector), and an indexer that maintains a `schema.lock.json` to avoid re-embedding unchanged content.

The retriever is wired into `ask()` via an optional `retriever` parameter. When omitted, prompt assembly is unchanged.

## Scope

### In scope

- **Chunker** — `chunkSchema(schema) → Chunk[]`; deterministic from the v2 artifact; chunk types: `table`, `column`, `cql`, `question`, `concept`, optional `relationship`
- **Stable chunk IDs** — based on schema ID and content; stable across OS/file-system ordering; long-body paragraph splitting with stable `#bc:N` suffixes
- **Sensitive propagation** — describable-layer chunks for sensitive columns excluded by default; `cql` chunks mentioning a sensitive column by name excluded; `includeSensitiveDescribable: true` overrides with a warning event
- **BYO embedder** — `Embedder = (texts: string[]) => Promise<number[][]>`; default reference: AI SDK `embedMany()`
- **BYO vector store** — `VectorStore` interface; three adapters:
  - In-memory (cosine, zero deps) — default for tests and small schemas
  - File-backed — embeddings in `<schemaId>.embeddings.bin` + `schema.lock.json`; checkable into version control
  - pgvector — production target; `pg` is an optional peer dependency
- **Indexer** — `buildSchemaIndex({ schema, embedder, store }) → { retriever, stats }`; content-hashed chunks skip re-embedding when unchanged; structured progress events
- **`ask({ retriever })`** — when supplied, retriever replaces the full DDL block with top-k focused chunks; when omitted, current behavior preserved
- **`askdb-rag` CLI** — `index` and `query` subcommands for non-library consumers

### Out of scope

- Schema chunking for non-v2 formats
- Automatic schema change detection (consumers call `buildSchemaIndex` to refresh)
- Hosted vector stores beyond pgvector (Pinecone, Weaviate, etc.) — BYO via the `VectorStore` interface
- Reranking or hybrid search

## Design decisions

- **Deterministic chunker** — two runs on the same artifact always produce byte-identical chunks. Chunk IDs are content-stable so the indexer can skip unchanged chunks reliably. File-system ordering never affects output.
- **BYO embedder and store** — AskDB does not bundle an embedder or mandate a vector store. The same principle as BYO model: consumers bring their own infrastructure. The `VectorStore` interface is the plug-in seam.
- **Sensitive chunks excluded by default** — the chunker excludes describable-layer content (descriptions, aliases, CQL sections) for sensitive columns. Embedding sensitive business context and making it retrievable is an opt-in decision by the host.
- **`schema.lock.json` for incremental indexing** — editing one table description should not re-embed every chunk. The lock file tracks per-chunk content hashes so only changed chunks are re-embedded on the next index run.
- **Full DDL path preserved** — when no retriever is supplied, `ask()` behavior is byte-identical to pre-RAG. RAG is additive, not a replacement.

## Contracts and API surface

```ts
// Chunker
chunkSchema(schema: NormalizedSchema, options?: ChunkOptions): Chunk[]

interface Chunk {
  id: string                     // e.g. "orders-users#table:public.orders"
  type: 'table' | 'column' | 'cql' | 'question' | 'concept' | 'relationship'
  text: string
  refs: string[]                 // schema IDs this chunk references
  schemaId: string
  sensitive?: boolean
}

// Indexer
buildSchemaIndex(options: IndexOptions): Promise<{ retriever: Retriever; stats: IndexStats }>

interface IndexOptions {
  schema: NormalizedSchema
  embedder: Embedder
  store: VectorStore
  options?: { includeSensitiveDescribable?: boolean }
}

// Vector stores
createMemoryStore(): VectorStore
createFileStore(options: { path: string }): VectorStore
createPgvectorStore(options: { connectionString: string; table: string; dimensions: number }): VectorStore

// ask() integration
ask({ ..., retriever?: Retriever }): Promise<AskResult>
```

Log events: `askdb.rag.indexing_started`, `askdb.rag.chunk_indexed`, `askdb.rag.chunks_reused`, `askdb.rag.indexing_completed`, `askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Golden chunk snapshot for the v2 fixture matches; two consecutive chunker runs produce byte-identical output; reordering files in the v2 directory does not change chunk IDs or texts.
- Sensitive-column fixture: describable-layer chunks for sensitive columns absent by default; `includeSensitiveDescribable: true` includes them with warning event.
- Indexer: first run indexes all chunks; second run with unchanged artifact reuses 100% (zero embedding calls); editing one description re-embeds only affected chunks.
- `schema.lock.json` round-trip: read → write → read produces identical contents.
- In-memory store: upsert + query + delete + filtering by `schemaId`, `types`, `refs` all work correctly.
- `ask({ retriever })` with a deterministic mock embedder + in-memory store: retrieved DDL contains expected tables for a fixture question.
- Without retriever: prompt output byte-identical to pre-RAG baseline (regression guard).
- pgvector integration test (CI-gated, requires Postgres + pgvector): upsert + query + delete against real extension.
