# Feature: Studio

**Status:** Complete  
**Packages:** `apps/studio` (`@askdb/studio`)

## Overview

AskDB Studio is a local browser-based authoring surface for describable schema artifacts. It is started with `askdb-studio --schema <path>`, which launches a local server and opens the browser app. The UI reads and writes the same `schema.json` + `tables/*.md` artifact as the TUI, using `@askdb/enrich` for all workspace logic.

Studio is built with Vite + React + shadcn/ui. The server is a small Express app that serves the compiled React assets and exposes a typed JSON API. All enrichment logic runs through `@askdb/enrich` — Studio does not depend on `@askdb/tui`.

The product shape follows the Prisma Studio pattern: a CLI command starts a local server, the server opens/serves a browser app, and the UI talks to a small local API. Studio is not a hosted service; it is a local developer tool.

## Scope

### In scope

- **Schema browser** — searchable/filterable table list with warning badges; table detail view with physical columns and relationships
- **Enrichment editor** — table description, aliases, primary entity, tags, common query language, example questions, per-column metadata; dirty state, save, revert
- **AI suggestion workflow** — suggest controls for table and column contexts; candidates presented for selection, not auto-applied; clear UI errors for missing/misconfigured AI env
- **RAG panel** — index status, stale state, dimensions/embedder mismatch, sensitive counts; build action; query debugger with scored chunk results
- **Ask panel** — sample NL→SQL generation with optional RAG toggle; renders SQL, explain text, schema warnings, retrieved chunks; generation only, no live execution
- **API** — `GET /api/workspace`, `POST /api/tables/:tableId`, `POST /api/suggest`, `GET /api/rag/status`, `POST /api/rag/index`, `POST /api/rag/query`, `POST /api/ask`
- **Build artifacts** — server TypeScript to `dist/`, React client to `dist/client/`; package tarball includes both

### Out of scope

- Live SQL execution against a database
- Multi-user / hosted deployment
- Terminal UI features — see [`schema-authoring-and-enrichment.md`](./schema-authoring-and-enrichment.md) for `@askdb/tui`
- Tenant policy authoring UI beyond the sample ask controls — see [`multi-tenancy.md`](./multi-tenancy.md)

## Design decisions

- **`@askdb/enrich`, not `@askdb/tui`** — Studio shares the headless workspace logic from `@askdb/enrich`. Depending on `@askdb/tui` would have coupled a browser app to a terminal UI package. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).
- **Local server + browser app pattern** — follows Prisma Studio: no hosted infrastructure, no auth, no remote data. The server is the trust boundary; it reads/writes the local schema artifact.
- **Typed DTOs shared between server and client** — `src/shared/api.ts` defines the Studio DTO types used by both the server handlers and the React client. Type-safety at the API boundary prevents silent shape drift.
- **shadcn/ui primitives** — consistent accessible components without a heavy UI framework dependency.

## Contracts and API surface

**API endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/workspace` | Schema metadata, table drafts, warning summaries, AI config status, concepts |
| `POST` | `/api/tables/:tableId` | Save a table draft |
| `POST` | `/api/suggest` | Return AI suggestion candidates |
| `GET` | `/api/rag/status` | Index state, stale reasons, store metadata |
| `POST` | `/api/rag/index` | Build the configured RAG index |
| `POST` | `/api/rag/query` | Return scored chunks for a question |
| `POST` | `/api/ask` | Generate SQL with optional RAG; returns SQL, explain, warnings, chunks |

**Server startup:**
```bash
askdb-studio --schema <path>   # default port 4983
askdb-studio --schema <path> --port 3000
```

## Test bar

- `pnpm --filter @askdb/studio build` succeeds; server TypeScript to `dist/`; React client to `dist/client/`.
- `@askdb/studio` depends on `@askdb/enrich` and does not depend on `@askdb/tui` (package assertion).
- API contract tests: each endpoint returns the documented shape; error responses include typed `code`.
- Schema editing: `POST /api/tables/:tableId` saves draft and reloads workspace from disk; reloading Studio shows saved values.
- AI suggestion: `POST /api/suggest` returns candidates; missing AI config returns a typed config error, not a 500.
- RAG: `POST /api/rag/index` builds index with mock or configured embedder; `POST /api/rag/query` returns scored chunks.
- Ask: `POST /api/ask` returns SQL and warnings; works with `ASKDB_MOCK_SQL` without a live model.
- Package tarball includes `bin`, server dist, client dist, README, LICENSE.
- Manual: `askdb-studio --schema fixtures/schemas/orders-users.schema` — browse tables, edit a description, save, confirm file updated, reload, confirm value persists.
