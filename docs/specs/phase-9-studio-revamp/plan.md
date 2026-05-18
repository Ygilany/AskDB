# Plan — Phase 9 (AskDB Studio revamp) (demoable milestones)

Numbered groups are **ordered** so each milestone is demoable. The first milestone keeps current behavior intact while creating the React build path.

Current baseline after the enrichment-package extraction: `@askdb/studio` already consumes `@askdb/enrich` for Schema v2 workspace/draft/save/suggestion helpers. The React revamp must preserve that boundary and keep `@askdb/tui` as a separate terminal surface, not a Studio dependency.

## 1 — React build skeleton inside `apps/studio`

- Add Vite + React + TypeScript frontend toolchain to `apps/studio`.
- Initialize Tailwind + shadcn/ui with the requested preset:

```bash
pnpm dlx shadcn@latest init --preset b1D0eCA4
```

- Add `src/web/` with a minimal app shell.
- Add a build script that emits static assets into `dist/client/`.
- Update the Studio server to serve compiled assets in production builds.
- Keep the existing API behavior unchanged.

**Demo:** `pnpm --filter @askdb/studio build` produces server output and React client assets; `askdb-studio --schema fixtures/schemas/orders-users.schema` serves the React shell.

## 2 — Typed Studio DTOs and client API

- Define Studio API DTO types in shared Studio source, e.g. `src/shared/api.ts`.
- Align DTOs with the current `@askdb/enrich` model for `Workspace`, `WorkspaceTable`, `TableDraft`, `ColumnDraft`, and `SuggestSource`.
- Type the existing endpoints:
  - `GET /api/workspace`
  - `POST /api/tables/:tableId`
  - `POST /api/suggest`
  - `GET /api/rag/status`
  - `POST /api/rag/index`
  - `POST /api/rag/query`
  - `POST /api/ask`
- Add a small React-side API client around `fetch`.
- Keep server responses backward-compatible where practical.
- Add server tests for DTO shape on key endpoints.
- Add a dependency-boundary test or package assertion that `@askdb/studio` depends on `@askdb/enrich` and does not depend on `@askdb/tui`.

**Demo:** The React app loads workspace metadata, renders schema id/path, table count, AI config state, and RAG status.

## 3 — Studio app shell and schema browser

- Build the main workbench layout:
  - Left table navigation.
  - Header/status bar.
  - Main table detail region.
  - Right inspector/panel region for RAG, Ask, and settings.
- Add searchable/filterable table list with warning badges.
- Add selected-table state and deep-link-friendly URL state if a router is chosen.
- Use shadcn controls for inputs, tabs, sheets/dialogs, alerts, buttons, and badges.

**Demo:** A user can open the fixture, search for a table, select it, and inspect physical columns and relationships.

## 4 — Enrichment editor

- Port current table-edit behavior into React forms:
  - table description
  - aliases
  - primary entity
  - tags
  - common query language
  - example questions
  - column metadata supported by the current server draft shape
- Preserve dirty state, save, and revert interactions.
- Call existing `POST /api/tables/:tableId`; server continues to write through `@askdb/enrich` helpers (`buildTableDraft`, `buildFrontmatter`, `replaceTableDescription`, `replaceH2Section`, `saveTable`).
- Make save feedback explicit and resilient to reload.

**Demo:** Editing a table description and common query language writes the expected `tables/*.md`; reloading Studio shows the saved values.

## 5 — AI suggestion workflow

- Add suggestion controls for table and column contexts using `POST /api/suggest`.
- Show provider/model status from workspace serialization.
- Present suggestions as selectable candidates, not auto-applied text.
- Handle missing/misconfigured AI env with clear UI errors.
- Keep deterministic behavior under `ASKDB_MOCK_SQL`/test modes where relevant.

**Demo:** With `OPENAI_API_KEY` configured, a user can request suggestions and apply one to a draft field. Without a key, the UI explains the missing config without crashing.

## 6 — RAG panel

- Add RAG status panel:
  - configured embedder
  - active store
  - index presence
  - stale state
  - dimensions/embedder mismatch
  - sensitive excluded/included counts
  - file presence when `rag.store=file`
  - store metadata when `rag.store=pgvector`
- Add build action through `POST /api/rag/index`.
- Add query debugger through `POST /api/rag/query`.
- Render retrieved chunks with ids, types, scores, refs, and sensitivity metadata.

**Demo:** A user can see that a fixture has no index, build it, query it, and inspect returned chunks.

## 7 — Ask panel

- Add sample question input and generated SQL result using `POST /api/ask`.
- Allow toggling RAG usage.
- Render:
  - generated SQL
  - explain text
  - schema warnings
  - retrieved chunks when RAG is enabled
  - errors from model configuration or stale RAG index
- Keep this as a generation/debug workflow, not a live execution workflow.

**Demo:** With a mock SQL env or model configured, a user asks a sample question and sees SQL plus retrieval context.

## 8 — Polish and accessibility

- Keyboard-accessible navigation and form controls.
- Loading, empty, error, dirty, and saved states for all major panels.
- Responsive layout that remains usable on laptop widths.
- No text overflow in toolbar buttons, list items, tabs, or badges.
- Confirm visual states for sensitive/warning indicators are distinct and readable.

**Demo:** Manual pass on the fixture at desktop and narrow widths shows usable layout and no overlapping controls.

## 9 — Tests and packaging

- Unit tests for DTO parsing/serialization and server endpoints.
- Browser/component tests for core React flows if the repo test stack supports it; otherwise add focused DOM tests with Vitest/jsdom.
- Add a no-live-LLM test path using existing mock env behavior.
- Ensure `files` in `apps/studio/package.json` includes compiled client assets.
- Verify `pnpm --filter @askdb/studio pack` contains bin, server dist, client dist, README, LICENSE, and NOTICE.

**Demo:** `pnpm --filter @askdb/studio test`, `pnpm --filter @askdb/studio build`, and package inspection all pass.

## 10 — Documentation

- Update `apps/studio/README.md` with:
  - new React Studio overview
  - local dev commands
  - build/package behavior
  - environment variables
  - RAG and mock modes
- Add a short note in `docs/roadmap.md` or `docs/platform.md` if the Studio-specific React/Vite choice should be documented beside the later hosted web app direction.

**Demo:** A new contributor can run the Studio dev server, edit the React UI, and build the package using the README alone.

---

**Implementation locus:** `apps/studio/` primarily; tests may touch root config only if needed for frontend testing.
