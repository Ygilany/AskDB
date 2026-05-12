# Phase 9 — AskDB Studio revamp (requirements)

Status: Draft

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

`@askdb/studio` already exists as a local browser UI served by `askdb-studio`. It reads a Schema v2 directory, edits the describable layer through `@askdb/enrich`, calls `@askdb/core` for sample NL-to-SQL, and uses `@askdb/rag` for local indexing/query checks.

The current UI is embedded as inline static strings in `apps/studio/src/static.ts`. That proved the surface, but it is now the limiting factor for a richer Studio experience.

This phase revamps Studio into a proper React application while preserving the useful Prisma Studio pattern: a CLI command starts a local server, the server opens/serves a browser app, and the UI talks to a small local API. Prisma Studio is the inspiration for product shape and workflow, not a dependency or a feature-for-feature target.

## Problem

Without this revamp:

- Studio UI changes are expensive because layout, state, and browser behavior are packed into static string assets.
- The current UI cannot comfortably grow into Prisma-Studio-like browsing, filtering, editing, and diagnostics.
- Schema authoring, RAG status, and sample query workflows are present but not organized around a durable design system.
- Future embeddable UI work lacks a realistic first-party React surface to extract patterns from.

## Scope (in)

### 1) Keep a single Studio package

`apps/studio` remains the implementation locus and publishes as `@askdb/studio`.

- One package owns the local server, CLI entrypoint, and React web app.
- Consumers still run `askdb-studio --schema ./my.schema` or `askdb studio --schema ./my.schema`.
- The package builds frontend assets into `dist/client/` and serves them from the existing local server.
- No separate hosted Studio service is introduced in this phase.

### 2) React application

Replace `apps/studio/src/static.ts` with a compiled React app.

Recommended layout:

```text
apps/studio/
  src/
    server/          # local HTTP API and asset serving
    web/             # React app source
      components/
      routes/
      lib/
      styles/
```

Stack:

- React + TypeScript.
- Vite for frontend bundling. This keeps Studio lightweight and package-local.
- Tailwind CSS + shadcn/ui using the requested preset:

```bash
pnpm dlx shadcn@latest init --preset b1D0eCA4
```

- Prefer shadcn primitives and local composition over a second component system.
- Use `lucide-react` icons where actions have standard symbols.

This is intentionally not the hosted web app from `docs/platform.md`. The hosted first-party web app may still choose Next.js later. Studio is a local package, closer to Prisma Studio's local developer workflow.

### 3) Prisma-Studio-like information architecture

Studio should loosely mirror the concept of Prisma Studio:

- Left navigation for schema objects.
- Main content focused on the selected table/model.
- Inspector-style panels for fields, relationships, enrichment, and diagnostics.
- Fast switching between tables without losing local draft state.
- Clear save/revert flow for artifact edits.
- Local-only status indicators for AI provider, RAG index, schema warnings, and stale generated assets.

AskDB-specific workflows:

- Browse physical schema from `schema.json`.
- Edit table and column describable metadata.
- Edit aliases, tags, primary entity, common query language, example questions, and concept links.
- Request AI enrichment suggestions.
- Build/query the RAG index.
- Generate sample SQL from a natural language question with optional RAG.
- Surface warnings from schema load, missing column markdown, stale RAG index, and AI/provider config.

### 4) Thin local API over existing packages

The backend remains a thin local API over existing AskDB packages:

- `@askdb/core`: schema load, ask/sample SQL, validation warnings.
- `@askdb/enrich`: Schema v2 workspace loading, editable drafts, markdown/frontmatter preservation, save helpers, bundling, concept validation, and AI suggestion target/context helpers.
- `@askdb/rag`: chunking, index status, file store, retriever checks.
- `@askdb/postgres`: Postgres dialect for sample SQL generation.

The React app must not duplicate Schema v2 parsing, markdown frontmatter writing, RAG chunking, or prompt assembly logic.
Studio must not depend on `@askdb/tui`; the TUI remains a separate terminal UI surface that also consumes `@askdb/enrich`.

### 5) Local-first and import-first

Studio remains a local authoring surface:

- Opens a local Schema v2 directory.
- Writes only the describable layer files it is asked to edit.
- Does not require a live database connection.
- Does not introduce hosted auth, accounts, telemetry, or a project cloud.
- AI calls remain BYO-provider through existing environment variables.
- RAG embeddings remain local to the schema artifact unless the user explicitly configures an external store in a later phase.

### 6) UX baseline

The UI should feel like a professional data/schema workbench, not a marketing site.

Required views:

- **Schema browser**: searchable table list, table counts, warning badges.
- **Table detail**: table summary, columns grid, relationships, and enrichment editor.
- **Column editor**: description, aliases, enum notes, sensitive metadata display, tags where supported.
- **RAG panel**: index status, stale reasons, build action, query debugger, retrieved chunks.
- **Ask panel**: natural-language question input, generated SQL, explain text, warnings, retrieved chunks when enabled.
- **Settings/status panel**: schema path, AI model/provider, embedder status, environment-driven capabilities.

Interaction rules:

- Edits are explicit: users can see dirty state before saving.
- Long-running actions show progress and terminal states.
- Errors include the relevant schema path, table id, or operation where safe.
- Sensitive content is never logged or rendered into diagnostics beyond existing Schema v2 policy.

### 7) API contract for the web app

Preserve the current API endpoints where possible:

- `GET /api/workspace`
- `POST /api/tables/:tableId`
- `POST /api/suggest`
- `GET /api/rag/status`
- `POST /api/rag/index`
- `POST /api/rag/query`
- `POST /api/ask`

Add versioned response types in Studio source so React code consumes typed DTOs rather than ad hoc objects.

API compatibility is best-effort within pre-1.0, but tests should pin the Studio UI contract once React is introduced.

## Scope (out)

- Row data browsing/editing against a live database. Prisma Studio does this; AskDB Studio does not in this phase.
- Hosted multi-user Studio.
- Authentication, teams, sharing, comments, or cloud storage.
- Next.js migration for `apps/studio`.
- New schema format or Schema v3 changes.
- Replacing `@askdb/enrich` helpers for Schema v2 markdown writing.
- External vector stores in Studio UI beyond the existing local file-backed RAG path.
- Embeddable SDK package. This phase may inform it, but does not publish it.

## Spec decisions

| Topic | Decision |
|---|---|
| Package shape | Keep one `@askdb/studio` package under `apps/studio`. |
| Frontend | React + TypeScript, bundled with Vite. |
| Design system | Tailwind + shadcn/ui with `--preset b1D0eCA4`. |
| Server | Keep a thin local Node HTTP server; no app framework required unless complexity forces it. |
| Product model | Prisma-Studio-like local browser workbench for schema/enrichment/RAG, not database row editing. |
| API reuse | Preserve existing Studio endpoints where possible and add typed DTOs. |
| Core reuse | Use `@askdb/core`, `@askdb/enrich`, `@askdb/rag`, and `@askdb/postgres`; no duplicate parsing, draft/save, suggestion-context, RAG, or prompt logic. |
| Data boundary | Import-first and local-first; no hosted service or mandatory database connection. |

## Open choices

- Whether to add a small router (`react-router`) or keep route state in local component state for the first version.
- Whether to use a data-fetching helper such as TanStack Query, or a small typed `fetchJson` wrapper.
- Whether shadcn's requested preset should replace the platform doc's currently listed first-party web preset, or remain Studio-specific.
- Whether table edits should save per section or as one whole-table draft.
- Whether RAG indexing should stream progress events (SSE) or stay request/response for v0.
- Whether Studio should auto-open the browser like Prisma Studio, or keep the current explicit local URL behavior.

## Success

After this phase:

1. Running `askdb-studio --schema ./fixtures/schemas/orders-users.schema` starts the local server and serves a compiled React app.
2. A user can browse tables, inspect columns, edit enrichment, save to `tables/*.md`, and reload without losing changes.
3. A user can build/query the local RAG index and see retrieved chunks tied back to schema objects.
4. A user can ask a sample natural-language question and inspect generated SQL, warnings, explain text, and retrieval context.
5. The Studio package remains installable as one npm package with no separate app deployment.
6. Studio UI tests cover the core flows without live LLM calls or live database access.

## References

- Prisma Studio local workflow: https://www.prisma.io/docs/cli/studio
- Prisma Studio concept and embedding direction: https://www.prisma.io/studio
- Prisma Studio embed package docs: https://www.prisma.io/docs/studio/integrations/embedding
- Current package: [`apps/studio/`](../../../apps/studio/)
- Enrichment package: [`packages/enrich/`](../../../packages/enrich/)
- ADR 0004: [`docs/adrs/0004-enrichment-package-boundary.md`](../../adrs/0004-enrichment-package-boundary.md)
- Schema v2 contract: [`docs/contracts/schema-v2.md`](../../contracts/schema-v2.md)
- RAG spec: [`docs/specs/phase-8-rag/`](../phase-8-rag/)
- Platform notes: [`docs/platform.md`](../../platform.md)
