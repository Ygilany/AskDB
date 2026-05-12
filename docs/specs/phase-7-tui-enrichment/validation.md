# Validation — Phase 7 (TUI enrichment) merge bar

Pair with **[`requirements.md`](./requirements.md)** (scope/decisions) and **[`plan.md`](./plan.md)** (milestones).

Implementation is ready to merge when **automated CI** passes, the **TUI has end-to-end coverage that doesn't require a live LLM**, and the **bundle command round-trips**.

## Automated

1. **Repo health**
   - `pnpm build` and `pnpm test` succeed from the repo root (Turbo parity unchanged).
   - All Phase 1 / 2 / 2.5 / 3 / 4 / 5 / 6 tests remain green; the Phase 5 v2 fixture's prompt assembly output is unchanged by anything in this phase.

2. **TUI tests** (`packages/tui/`)
   - **Headless author flow** — a test harness that drives the TUI without a real terminal (mock prompts) walks: open the v2 fixture → edit `orders` table description → save → assert file content. Round-trip via the Phase 5 writer.
   - **AI-suggest with mock model** — a test using a deterministic mock `LanguageModel` proves the suggest action queues a candidate and only persists on confirm. Without confirm, no file changes.
   - **Idempotency** — opening, viewing, and quitting without edits leaves files byte-identical.
   - **Sensitive warning** — typing a description that mentions a sensitive column name surfaces the warning event/log without blocking save.
   - **Re-introspection ingestion** — given a v2 fixture whose `schema.json` includes a column id not present in any `tables/*.md`, opening the TUI queues that column for description; given an orphan front-matter id, the TUI prompts to prune.

3. **Shared enrichment tests** (`packages/enrich/`)
   - Workspace loading/saving, draft construction, markdown section replacement, concepts persistence, concept link validation, and bundling are covered without Ink/React.
   - `@askdb/tui` and `@askdb/studio` import shared authoring helpers from `@askdb/enrich`; Studio must not depend on `@askdb/tui`.

4. **Concepts editor**
   - Adding a `concept:customer` linked to `table:users` produces a valid `concepts.md`; reloading via `@askdb/core` exposes the concept in the normalized representation.

5. **Bundle round-trip**
   - `bundle` of the v2 fixture produces a single JSON; loading the JSON via Phase 5's loader yields a normalized representation equal to loading the directory.

6. **Pack and metadata for `@askdb/enrich` and `@askdb/tui`**
   - `@askdb/enrich` has package metadata, exports, README, license, and a tarball containing `dist/`.
   - `pnpm pack` produces a tarball that excludes test files and includes `dist/`, `README.md`, `LICENSE`.
   - `package.json` has correct `bin`, `engines`, `repository`, `license`.
   - The downstream consumer smoke test from Phase 4 is extended to install `@askdb/tui` and run a non-interactive command (e.g. `askdb-tui --version`).

## Manual (short)

- Run `askdb introspect --url postgres://...` (Phase 6) against a small dev DB, then run the TUI interactively against the resulting `<schemaId>.schema/`:
  - Walk through `orders`: add a description, 2 aliases, edit one column.
  - Use AI-suggest (with a real `OPENAI_API_KEY`) to generate suggestions; reject one, accept one with edits.
  - Save and re-open; confirm content matches.
- Diff the resulting `tables/orders.md` against expectations: front-matter is YAML, body has `# Table: orders`, the recognized H2 sections are present where edited, no other content is touched.
- Run `askdb-tui bundle <schemaId>.schema/` and inspect the bundled JSON for fidelity.
- Re-run `askdb introspect` after adding a new column to the dev DB; reopen the TUI; confirm the new column appears as un-described.

## Non-blockers for Phase 7 merge

- Web catalog UI authoring against the same artifact (Phase 9).
- RAG / embedding (Phase 8).
- Multi-language descriptions / i18n.
- Collaborative editing — Git is the merge story for now.
- Full `bounded_results` summarization.

## References

- [`requirements.md`](./requirements.md) — scope and decisions
- [`plan.md`](./plan.md) — milestones
- [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md) — format contract
- [`docs/adrs/0004-enrichment-package-boundary.md`](../../adrs/0004-enrichment-package-boundary.md) — shared enrichment package boundary
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive identifier rules
- [`docs/specs/phase-5-schema-v2-core/`](../phase-5-schema-v2-core/) — v2 reader/writer this phase consumes
- [`docs/specs/phase-6-introspection/`](../phase-6-introspection/) — produces v2 directories the TUI opens
- [`docs/specs/phase-8-rag/`](../phase-8-rag/) — downstream consumer
