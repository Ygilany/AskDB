# Validation — Phase 9 (AskDB Studio revamp) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when the React Studio builds as part of `@askdb/studio`, preserves current server behavior, and validates the main schema authoring, RAG, and sample SQL workflows without live external services.

## Automated

1. **Repo health**
   - `pnpm --filter @askdb/studio build` succeeds.
   - `pnpm --filter @askdb/studio test` succeeds.
   - Root `pnpm build` and `pnpm test` remain green or failures are explicitly unrelated and documented.

2. **Package build**
   - Server TypeScript emits to `dist/`.
   - React client emits to `dist/client/`.
   - `askdb-studio` serves `index.html`, JS, and CSS assets from the built package.
   - The package tarball includes `bin`, server dist, client dist, README, LICENSE, and NOTICE.
   - `@askdb/studio` depends on `@askdb/enrich` and does not depend on `@askdb/tui`.

3. **API contract**
   - `GET /api/workspace` returns typed schema metadata, table drafts, warning summaries, AI config status, and concepts.
   - `POST /api/tables/:tableId` saves a draft and reloads the workspace from disk.
   - `POST /api/suggest` returns candidate text or a typed config error.
   - `GET /api/rag/status` reports index state, stale reasons, and the active store metadata.
   - `POST /api/rag/index` builds the configured index (`memory`, file-backed, or `pgvector`) with a mock or configured embedder.
   - `POST /api/rag/query` returns scored chunks.
   - `POST /api/ask` returns SQL, explain text, warnings, and optional RAG chunks.

4. **Schema editing**
   - Editing table description, aliases, tags, primary entity, common query language, and example questions writes expected `tables/*.md`.
   - Reloading Studio round-trips the saved values.
   - Missing-column markdown warnings remain visible and do not block unrelated saves.
   - Invalid table ids return a typed 404 error.

5. **React UI behavior**
   - Workspace load renders schema id/path and table list.
   - Table search/filter works.
   - Selecting a table renders physical columns, relationships, and editable enrichment.
   - Dirty, saving, saved, error, and reverted states are test-covered.
   - AI suggestion results can be applied to a draft field without immediately saving to disk.

6. **RAG workflow**
   - Without an index, the RAG panel shows missing/stale state and disables query actions.
   - Building an index updates status for the configured store.
   - When `rag.store=file`, Studio writes the expected local index files.
   - When `rag.store=pgvector`, Studio reports the configured table/strategy and does not require local embedding files.
   - Querying RAG renders chunk id, type, score, refs, and text preview.
   - Changing relevant schema content marks the index stale.
   - Sensitive counts are displayed as counts only.

7. **Ask workflow**
   - With `ASKDB_MOCK_SQL`, sample SQL generation works without a live model.
   - With RAG disabled, the response contains no retrieved chunks.
   - With RAG enabled and a fresh index, retrieved chunks are shown with generated SQL.
   - With RAG enabled and a stale/missing index, the UI surfaces the server error and preserves the user's question draft.

8. **Accessibility and layout**
   - Main navigation, forms, tabs, buttons, dialogs/sheets, and panels are keyboard reachable.
   - Form controls have accessible labels.
   - Error and warning states are not color-only.
   - No toolbar/button/list/tab text overflows at common laptop widths.
   - The app remains usable at a narrow viewport suitable for split-screen development.

9. **No unwanted data paths**
   - Studio does not require a live database connection for browse/edit/RAG/sample SQL generation.
   - No hosted auth, account, telemetry, or cloud write path is introduced.
   - UI code does not parse or write Schema v2 markdown directly; server continues to use `@askdb/enrich` helpers.

## Manual

- Run `pnpm --filter @askdb/studio build`.
- Start Studio against `fixtures/schemas/orders-users.schema`.
- Open the local URL and verify:
  - table search/select works
  - table enrichment can be edited, saved, and reloaded
  - AI suggestion missing-key state is clear when no key is configured
  - RAG index can be built with mock embedder mode
  - RAG query returns chunks
  - sample Ask flow works with `ASKDB_MOCK_SQL`
  - if `rag.store=pgvector`, the status panel reports the pgvector table/strategy instead of local embedding files
- Inspect the edited `tables/*.md` diff to confirm only intended describable-layer changes occurred.
- Pack the package and inspect the tarball contents:

```bash
pnpm --filter @askdb/studio pack
```

## Non-blockers for Phase 9 merge

- Live row data browsing/editing.
- Hosted Studio deployment.
- Next.js hosted app.
- Embeddable SDK package.
- In-app vector store configuration editing.
- Streaming RAG indexing progress.
- Browser auto-open behavior, as long as the local URL is printed.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`apps/studio/`](../../../apps/studio/) — implementation locus
- [`packages/enrich/`](../../../packages/enrich/) — shared enrichment logic
- [`docs/adrs/0004-enrichment-package-boundary.md`](../../adrs/0004-enrichment-package-boundary.md)
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- [`docs/specs/phase-8-rag/`](../phase-8-rag/)
