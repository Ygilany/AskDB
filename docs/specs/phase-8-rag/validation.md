# Validation — Phase 8 (RAG layer) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, the **chunker is deterministic and sensitive-aware**, and **`ask({ retriever })`** is contract-tested against the v2 fixture.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity unchanged).
   - All Phase 1 / 2 / 2.5 / 3 / 4 / 5 / 6 / 7 tests remain green; the Schema v2 fixture's prompt output is byte-identical to the Phase 5 baseline when no retriever is wired (regression guard).

2. **Chunker determinism** (`packages/rag/`)
   - **Golden chunk snapshot** for the v2 fixture (`fixtures/schemas/orders-users.schema/.chunks.golden.json`) matches.
   - Two consecutive runs produce byte-identical chunk lists (ids, texts, ordering).
   - Reordering files in the v2 directory does **not** change chunk ids or texts.
   - Long-description fixture: paragraph-boundary splitting produces the expected `#bc:1`, `#bc:2`, ... suffixes.

3. **Sensitive propagation** (chunker)
   - Sensitive-column fixture: describable-layer chunks for sensitive columns absent by default.
   - `Common query language` chunks that mention a sensitive column by name are excluded entirely.
   - With `includeSensitiveDescribable: true`: those chunks are present and `askdb.rag.sensitive_chunks_included` warning event is emitted (counts only — no identifiers).

4. **Indexer + lock file**
   - First run on the v2 fixture indexes all expected chunks; second run with an unchanged artifact reuses 100% (no embedding calls).
   - Editing one description re-embeds **only** the affected chunk and any dependent split chunks (`#bc:N`).
   - `schema.lock.json` round-trip: read → write → read produces identical contents.

5. **Vector stores**
   - **In-memory:** upsert + query + delete + filtering by `schemaId` / `types` / `refs`.
   - **File-backed:** binary write + read produces results equivalent to in-memory; lock file re-use works.
   - **pgvector:** integration test (CI-gated, Postgres + pgvector required) covers upsert + query + delete; unit tests with mocked client cover the emitted SQL.

6. **`Retriever` + `ask()` wiring** (`packages/core/`)
   - With a **deterministic mock embedder** + in-memory store, `ask({ retriever })` retrieves the expected chunks for fixture questions and synthesizes the documented DDL layout.
   - Without a retriever, prompt output is **byte-identical** to Phase 5 (regression guard).
   - Sensitive identifiers still appear in synthesized DDL (via `@askdb/core` formatting), tagged `(sensitive)` per existing rules.
   - Schema-size threshold: when the schema is below the configured chunk-count threshold and a retriever is supplied, full DDL inlining is preferred (regression test pins this behavior so it's intentional, not accidental).

7. **Logging contract**
   - Structured events under `askdb.rag.*` use the Phase 2 field shape (`event`, `correlationId`, etc.).
   - Sensitive logs are counts only — a regex test fails if any `askdb.rag.*` event contains a recognizable column name pattern.

8. **Pack and metadata**
   - `pnpm pack` for `@askdb/rag` produces a clean tarball; `package.json` has `"private": false`, valid `bin`, `engines`, `repository`, `license`, and `peerDependenciesMeta` for `pg`.
   - Phase 4 consumer install smoke is extended to install `@askdb/rag`, build the in-memory index against the fixture, and run `ask({ retriever })` end-to-end with a mock model + fake executor.

## Manual (short)

- Run `askdb-rag index fixtures/schemas/orders-users.schema/ --store file` and inspect the resulting `*.embeddings.bin` + `schema.lock.json`.
- Run `askdb-rag query fixtures/schemas/orders-users.schema/ --question "How much revenue did we make last month?"` — confirm the `orders` cql chunk and table chunk surface in the top-k.
- With Pagila + pgvector available, repeat the index + query against pgvector; confirm parity with the file-backed store.
- Spot-check `schema.lock.json` after a description edit — only the affected chunk's hash changed.

## Non-blockers for Phase 8 merge

- Reranking / hybrid search (clean extension behind the same `Retriever` shape later).
- Lancedb / sqlite-vss / Pinecone / Weaviate adapters.
- Multi-modal / image embeddings.
- `bounded_results` summarization or row data → model paths.
- Auto-embedding inside `ask()` (consumers must call `buildSchemaIndex` explicitly — no magic).
- Web catalog UI consuming RAG (Phase 9).

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — chunking + sensitive rules
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — Schema v2 reader/writer this phase consumes
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — produces the v2 directories this phase chunks
- [`docs/specs/phase-7-tui-enrichment/`](../phase-7-tui-enrichment/) — enriches the describable layer this phase chunks
- [`docs/specs/phase-4-publish-npm/`](../phase-4-publish-npm/) — published packages context
