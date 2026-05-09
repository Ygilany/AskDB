# Plan — Phase 8 (RAG layer) (demoable milestones)

Numbered groups are **ordered** so each milestone is **demoable**. The chunker lands first because everything else depends on its output and because it's the only piece that touches the v2 contract directly.

## 1 — `@askdb/rag` package skeleton

- `packages/rag/` workspace package: `package.json`, ESM, depends on `@askdb/core`.
- Sub-exports planned: `.` (chunker, types, indexer), `./stores/memory`, `./stores/file`, `./stores/pgvector`.
- `bin: { "askdb-rag": "./dist/bin.js" }` for `index` / `query` CLI commands (small, optional — most consumers will use the library).
- TypeScript build mirrors `@askdb/core` (tsconfig.build.json; emits `dist/`).

**Demo:** `pnpm build` produces `packages/rag/dist/index.js` with the expected exports; the package installs alongside `@askdb/core` in the consumer smoke test from Phase 4.

## 2 — Deterministic chunker

- Implement `chunkSchema(schema, options) → Chunk[]` per [Chunking rules](../../contracts/schema-v2.md#chunking-rules).
- Chunk types: `table`, `column`, `cql`, `question`, `concept`, optional `relationship`.
- Stable id scheme matches the contract.
- Long-body splitting on paragraph boundaries with stable suffixes (`#bc:1`, `#bc:2`).
- Sensitive propagation: exclude describable-layer chunks per the contract; identifier-bearing prompts come from `@askdb/core` and are not chunker output.
- Deterministic ordering: chunks sorted by id; stable across OS/file-system ordering.
- Tests:
  - Golden chunk snapshot for the v2 fixture (`fixtures/schemas/orders-users.schema/.chunks.golden.json`).
  - Two runs on the same artifact produce byte-identical output.
  - Sensitive-column fixture: describable-layer chunks excluded; counts logged.
  - Long-description fixture: paragraph-boundary splitting produces stable `#bc:N` suffixes.

**Demo:** A test runs the chunker against the v2 fixture and asserts the golden snapshot; intentionally edit a description and watch only the affected chunks change.

## 3 — In-memory vector store

- Implement `createMemoryStore() → VectorStore` with cosine over `Float32Array`.
- `upsert` stores vector + payload; `query` returns top-k by cosine; `delete` removes by id.
- Optional `hashesByPrefix` to support skip-reembed when paired with the file-backed store.
- Tests:
  - Upsert + query round-trip with a fixed deterministic embedder mock (returns hashed vectors).
  - Filtering by `schemaId`, `types`, and `refs` works.

**Demo:** A 30-line script in `examples/rag-memory/` indexes the v2 fixture with a mock embedder, queries "How much revenue did we make last month?", and prints the top chunks (which include the `orders` cql chunk).

## 4 — Indexer + lock file

- Implement `buildSchemaIndex({ schema, embedder, store, options }) → { retriever, stats }`.
- Compute per-chunk content hashes; write/read `schema.lock.json` to skip unchanged chunks.
- Structured progress events (`askdb.rag.indexing_started`, `askdb.rag.chunk_indexed`, `askdb.rag.chunks_reused`, `askdb.rag.indexing_completed`) consistent with Phase 2 logging.
- Sensitive logs: counts only (`askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`).
- Tests:
  - First run indexes all chunks; second run with unchanged artifact reuses everything.
  - Edit one description; only affected chunks re-embed.
  - `includeSensitiveDescribable: true` flips counts; warning event emitted.

**Demo:** Build the index twice; the second run reports `chunksReused = N` and emits zero embedding calls.

## 5 — `Retriever` + `ask()` wiring

- Implement `Retriever` interface; the retriever returned by `buildSchemaIndex` calls `embedder([question]) → store.query(...)`.
- Wire `ask({ retriever })` in `@askdb/core`:
  - When supplied, call retriever, synthesize a focused DDL block from retrieved chunks, and use that in place of the full DDL.
  - When omitted, current Phase 5 behavior preserved.
- Synthesized DDL layout (decided in implementation): table chunks first with full column definitions, then column-chunk descriptions, then `Common query language`, then concepts, then example questions as system context.
- Tests:
  - With a deterministic mock embedder + in-memory store, retrieved DDL contains the expected tables for a fixture question.
  - Without a retriever, prompt output is byte-identical to Phase 5 (regression guard).
  - Sensitive identifiers still appear in retrieved DDL (via `@askdb/core` formatting), tagged `(sensitive)` per existing rules.

**Demo:** The Pagila fixture (or a synthetic large schema) produces a tight DDL block for a focused question; the same call without the retriever produces the full DDL.

## 6 — File-backed store

- Implement `createFileStore({ path }) → VectorStore`.
- Embeddings serialized as binary (`<schemaId>.embeddings.bin`); metadata in `schema.lock.json`.
- File format documented (versioned header, payload schema, vector dimensions).
- Tests:
  - Round-trip write → read produces identical results to in-memory.
  - Lock file re-use works as in milestone 4.

**Demo:** `askdb-rag index fixtures/schemas/orders-users.schema/ --store file` writes `.embeddings.bin` + `schema.lock.json`; running `query` from the file store returns the same top-k results.

## 7 — pgvector store

- Implement `createPgvectorStore({ connectionString, table, dimensions }) → VectorStore`.
- Documented `CREATE EXTENSION` + table DDL; the adapter does **not** auto-run them.
- IVFFlat vs. HNSW: pick a sensible default (decision recorded in `requirements.md` after a quick spike); allow override.
- `pg` is an optional peer dep of `@askdb/rag` (parallel to Phase 4's `@askdb/core` decision).
- Tests:
  - Integration test (CI-gated, requires Postgres + pgvector) covering upsert + query + delete.
  - Unit tests with a mocked client cover the SQL the adapter emits.

**Demo:** With Pagila + pgvector available, `askdb-rag index` writes vectors into the configured table; `ask({ retriever })` produces the same retrieved DDL as the in-memory store.

## 8 — `askdb-rag` CLI (optional surface)

- `askdb-rag index <schema-dir> [--store memory|file|pgvector] [--embedder ...]` — convenience wrapper for non-library users.
- `askdb-rag query <schema-dir> --question "..."` — debug retrieval; prints top-k chunks with scores.
- Reuses Phase 2 logging conventions; no execution path (pure index/query).

**Demo:** A new contributor can index and query the fixture from the CLI without writing code.

## 9 — Documentation

- `packages/rag/README.md` with a working "60-second quickstart" using the in-memory store.
- `docs/integration/rag-recipes.md`:
  - BYO embedder: OpenAI, AI Gateway, Cohere, Voyage, Ollama.
  - BYO store: in-memory, file-backed, pgvector, "I have my own".
  - When to use RAG (chunk-count threshold guidance).
- Cross-link from `docs/mission.md`, `docs/platform.md`, `docs/roadmap.md` (already linked).

**Demo:** Following the recipes, a consumer wires a non-default embedder + non-default store and runs `ask({ retriever })` end-to-end.

## 10 — Pack and publish prep

- `pnpm pack` for `@askdb/rag` excluding test files; verify `bin`, `engines`, `repository`, `license`, `peerDependenciesMeta` (for `pg`).
- Extend the Phase 4 consumer install smoke to include `@askdb/rag` and exercise the in-memory store.
- Add a changeset for the v0.1.0 release of `@askdb/rag` (lockstep with `@askdb/core` if a contract bump is involved).

**Demo:** `pnpm pack` produces a clean tarball; the smoke test installs and uses `@askdb/rag` without errors.

---

**Implementation locus:** `packages/rag/` (new package), `packages/core/src/ask.ts` (retriever wiring + synthesized DDL), `fixtures/schemas/` (golden chunk snapshot), `docs/integration/rag-recipes.md`.
