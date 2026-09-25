# Feature: RAG Layer

**Status:** Complete  
**Packages:** `@askdb/rag`

## Overview

The RAG layer adds retrieval over the describable schema artifact so large schemas don't blow up the NL→SQL prompt. For small schemas, `ask()` inlines the full DDL block. For large schemas (50+ tables, hundreds of columns), a retriever selects the most relevant chunks for the question and uses those in place of the full DDL.

`@askdb/rag` provides: a deterministic chunker that segments a describable schema artifact into typed chunks, a BYO embedder interface, BYO vector store interface with three built-in adapters (in-memory, file-backed, pgvector), and an indexer that skips re-embedding content the store already holds (verified against the store's own content hashes, with `schema.lock.json` recording the embedder, store, and dimensions).

The retriever is wired into `ask()` via an optional `retriever` parameter. When omitted, prompt assembly is unchanged.

## Scope

### In scope

- **Chunker** — `chunkSchema(sources) → { chunks, stats }`; deterministic from the schema artifact; chunk types: `table`, `column`, `cql`, `question`, `concept`, `tenant-policy`, optional `relationship`
- **Stable, schema-scoped chunk IDs** — `chunk:<schemaId>:<local-id>` (e.g. `chunk:orders-users:table:public.orders#cql`); stable across OS/file-system ordering; long-body paragraph splitting with stable `#bc:N` suffixes. Several schemas can share one store.
- **Sensitive propagation** — describable-layer content for sensitive columns/tables excluded by default; `cql` / example-question / business-context chunks and concepts mentioning a sensitive column by name (whole word, case-insensitive) excluded; table descriptions/aliases and non-sensitive column descriptions/notes that mention one are dropped; relationship chunks touching a sensitive column excluded; `includeSensitiveDescribable: true` overrides with a warning event
- **BYO embedder** — `Embedder = (texts: string[]) => Promise<number[][]>`; default reference: AI SDK `embedMany()`
- **BYO vector store** — `VectorStore` interface; three adapters:
  - In-memory (cosine, zero deps) — default for tests and small schemas
  - File-backed — `<basePath>.embeddings.bin` + `<basePath>.embeddings.json` (crash-safe temp-file + rename writes, checksum-verified on load); checkable into version control alongside `schema.lock.json`
  - pgvector — production target; persists a `content_hash` column; `pg` is an optional peer dependency
- **Indexer** — `buildSchemaIndex({ schema, embedder, store }) → { retriever, stats, chunks }`; a chunk is skipped only when the store reports the same content hash for its id; orphan pruning is scoped to the schema; `force: true` re-embeds everything; structured progress events
- **`ask({ retriever })`** — when supplied, retriever replaces the full DDL block with top-k focused chunks; when omitted, current behavior preserved
- **`askdb-rag` CLI** — `index` and `query` subcommands for non-library consumers

### Out of scope

- Schema chunking for non-describable schema formats (e.g. raw DDL strings)
- Automatic schema change detection (consumers call `buildSchemaIndex` to refresh)
- Hosted vector stores beyond pgvector (Pinecone, Weaviate, etc.) — BYO via the `VectorStore` interface
- Reranking or hybrid search

## Design decisions

- **Deterministic chunker** — two runs on the same artifact always produce byte-identical chunks. Chunk IDs are content-stable so the indexer can skip unchanged chunks reliably. File-system ordering never affects output.
- **BYO embedder and store** — AskDB does not bundle an embedder or mandate a vector store. The same principle as BYO model: consumers bring their own infrastructure. The `VectorStore` interface is the plug-in seam.
- **Sensitive chunks excluded by default** — the chunker excludes describable-layer content (descriptions, aliases, CQL sections) for sensitive columns. Embedding sensitive business context and making it retrievable is an opt-in decision by the host.
- **The store is the source of truth for incremental indexing** — editing one table description should not re-embed every chunk, but a lock file alone can't prove the vectors exist (switching stores, a restarted in-memory store, or a fresh pgvector database with a committed lock would otherwise silently index nothing). Stores that implement `hashesByPrefix` (all built-ins) report what they hold; only chunks whose id + content hash they don't hold are embedded.
- **`schema.lock.json` guards identity** — the lock (version 2) records `embedderId`, `dimensions`, store identity (`kind` + `location`, e.g. the file store's `basePath` or the pgvector table), and per-chunk hashes. A missing lock, a lock from an older version, a different embedder id (including unset vs. set), or different dimensions re-embeds everything. Stores that can't report hashes fall back to the lock's hashes when the store identity matches. Upgrading from a version-1 lock (unscoped chunk ids) triggers a one-time full reindex; the old ids listed in that lock are deleted.
- **Full DDL path preserved** — when no retriever is supplied, `ask()` behavior is byte-identical to pre-RAG. RAG is additive, not a replacement.

## Contracts and API surface

```ts
// Chunker
chunkSchema(sources: ChunkerSources, options?: ChunkOptions): { chunks: Chunk[]; stats: ChunkStats }
chunkIdPrefix(schemaId: string): string   // "chunk:<schemaId>:"

interface Chunk {
  id: string                     // e.g. "chunk:orders-users:table:public.orders"
  type: 'table' | 'column' | 'cql' | 'question' | 'concept' | 'relationship' | 'tenant-policy'
  text: string
  refs: string[]                 // schema IDs this chunk references
  schemaId: string
  sensitive: boolean
}

// Indexer
buildSchemaIndex(options: BuildSchemaIndexOptions): Promise<{ retriever: Retriever; stats: IndexStats; chunks: Chunk[] }>

interface BuildSchemaIndexOptions {
  schema: ChunkerSources | NormalizedSchemaV2
  embedder: Embedder
  store: VectorStore
  embedderId?: string
  lockFilePath?: string
  force?: boolean                // re-embed every chunk
  chunkOptions?: { includeSensitiveDescribable?: boolean; emitRelationships?: boolean; chunkSizeMaxChars?: number }
}

// Vector stores
interface VectorStore {
  upsert, query, delete
  hashesByPrefix?(prefix: string): Promise<Record<string, string>>  // store-verified skip-reembed
  idsBySchema?(schemaId: string): Promise<string[]>                 // schema-scoped orphan pruning
  describe?(): { kind: string; location?: string; dimensions?: number } // recorded in the lock
}
createMemoryStore(): MemoryStore
createFileStore(options: { basePath: string; autoFlush?: boolean }): FileStore
createPgvectorStore(options: { connectionString?: string; client?: PgClient; table?: string; dimensions: number; indexStrategy?: 'hnsw' | 'ivfflat' | 'none'; resolveFrom?: string }): PgvectorStore

// ask() integration
ask({ ..., retriever?: Retriever }): Promise<AskResult>
```

Log events: `askdb.rag.indexing_started`, `askdb.rag.chunk_indexed`, `askdb.rag.chunks_reused`, `askdb.rag.indexing_completed`, `askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Golden chunk snapshot for the schema fixture matches; two consecutive chunker runs produce byte-identical output; reordering files in the schema directory does not change chunk IDs or texts.
- Sensitive-column fixture: describable-layer chunks for sensitive columns absent by default; `includeSensitiveDescribable: true` includes them with warning event.
- Indexer: first run indexes all chunks; second run with unchanged artifact reuses 100% (zero embedding calls); editing one description re-embeds only affected chunks; an up-to-date lock with an empty/different store re-embeds everything; indexing one schema never deletes another schema's chunks in a shared store; a version-1 lock triggers a full reindex.
- `schema.lock.json` round-trip: read → write → read produces identical contents.
- In-memory store: upsert + query + delete + filtering by `schemaId`, `types`, `refs` all work correctly; query-vector dimension mismatches throw.
- File store: temp-file + rename writes; a `.bin`/`.json` mismatch fails with a reindex hint.
- `ask({ retriever })` with a deterministic mock embedder + in-memory store: retrieved DDL contains expected tables for a fixture question.
- Without retriever: prompt output byte-identical to pre-RAG baseline (regression guard).
- pgvector integration test (CI-gated, requires Postgres + pgvector via `ASKDB_PGVECTOR_URL`; `pnpm pgvector:up && pnpm pgvector:test`): upsert + query + delete, content-hash reporting, `content_hash` migration of older tables, dimension-mismatch detection in `ensureSchema()`, and store-verified reindexing against the real extension.
