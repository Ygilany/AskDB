# Feature: Studio

**Status:** Complete  
**Packages:** `apps/studio` (`@askdb/studio`)

## Overview

AskDB Studio is a local browser-based authoring surface for describable schema artifacts. It is started with `askdb-studio --schema <path>`, which launches a local server and opens the browser app. The UI reads and writes the standard `schema.json` + `tables/*.md` artifact, using `@askdb/enrich` for all workspace logic.

Studio is built with Vite + React + shadcn/ui. The server is a small Express app that serves the compiled React assets and exposes a typed JSON API. All enrichment logic runs through `@askdb/enrich`.

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
- Tenant policy authoring UI beyond the sample ask controls — see [`multi-tenancy.md`](./multi-tenancy.md)

## Design decisions

- **Workspace logic lives in `@askdb/enrich`** — Studio shares the headless workspace logic from `@askdb/enrich` rather than owning it, so custom authoring surfaces can build on the same behavior. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).
- **Local server + browser app pattern** — follows Prisma Studio: no hosted infrastructure, no user accounts, no remote data. The server is the trust boundary; it reads/writes the local schema artifact. See [Security model](#security-model) for how the local API is protected from other sites in the developer's browser.
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

## Security model

Studio is a local dev tool whose API can execute SQL against the configured database and write schema/config files. It must not be drivable by arbitrary web pages the developer visits. Implemented in `apps/studio/src/request-guard.ts` and applied in the `createStudioServer` router before any route:

- **Bind:** loopback (`127.0.0.1`) by default. Binding to a non-loopback host prints a startup warning.
- **Host allowlist (every request, static assets included):** hostname must be `localhost`, `127.0.0.1`, `[::1]`, or the configured non-wildcard listen host (for wildcard binds, this machine's interface addresses), and the port must equal the port the connection arrived on. Otherwise `403`. Defeats DNS rebinding.
- **Per-launch session token:** `crypto.randomBytes(32)` hex, injected into the served `index.html` as `<meta name="askdb-studio-token">` and required on every `/api/*` request as `x-askdb-studio-token` (timing-safe compare). Otherwise `403`. The web client sends it from the single fetch helper in `src/web/api.ts`; embedders can read it from `StudioServer.sessionToken`.
- **Origin / content type:** non-GET/HEAD/OPTIONS `/api/*` requests with an `Origin` header must be same-origin with the request's `Host` (`403` otherwise); requests with a body must be `Content-Type: application/json` (`415` otherwise), which forces a CORS preflight that Studio never answers.
- **Defense in depth:** setup (`/api/setup/*`), resync (`POST /api/introspect`), and driver install stay loopback-client-only. `index.html` is served with `X-Frame-Options: DENY`.
- **Known limit:** on a non-loopback bind, anyone who can load the page from an allowed address gets the token. The token protects against cross-site browser attacks, not against untrusted networks.
- **Design record:** why this is an in-page per-launch token rather than a Jupyter-style login token, the accepted limits, and the triggers for revisiting are in [ADR 0009](../adrs/0009-studio-local-api-protection.md).
- **Setup config writer:** every value interpolated into the generated `askdb.config.ts` is emitted with `JSON.stringify` (the file is later executed via jiti); env names must match `^[A-Z][A-Z0-9_]*$`, and paths reject control characters. `askdb init` uses the same escaping.

## Test bar

- `pnpm --filter @askdb/studio build` succeeds; server TypeScript to `dist/`; React client to `dist/client/`.
- `@askdb/studio` depends on `@askdb/enrich` for all workspace logic (package assertion).
- API contract tests: each endpoint returns the documented shape; error responses include typed `code`.
- Schema editing: `POST /api/tables/:tableId` saves draft and reloads workspace from disk; reloading Studio shows saved values.
- AI suggestion: `POST /api/suggest` returns candidates; missing AI config returns a typed config error, not a 500.
- RAG: `POST /api/rag/index` builds index with mock or configured embedder; `POST /api/rag/query` returns scored chunks.
- Ask: `POST /api/ask` returns SQL and warnings; works with `ASKDB_MOCK_SQL` without a live model.
- Request guard: spoofed `Host` → `403`; cross-origin POST → `403`; `text/plain` POST → `415`/`403`; missing or wrong token → `403`; served `index.html` contains the token.
- Setup writer: quotes/backslashes in paths round-trip as literal strings; control characters and invalid env names are rejected.
- Package tarball includes `bin`, server dist, client dist, README, LICENSE.
- Manual: `askdb-studio --schema fixtures/schemas/orders-users.schema` — browse tables, edit a description, save, confirm file updated, reload, confirm value persists.
