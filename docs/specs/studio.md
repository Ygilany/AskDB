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

- Live SQL execution beyond the opt-in, read-only Playground execute path (see [Execute](#execute)); no writes, no unbounded result sets
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
| `GET`/`POST`/`DELETE` | `/api/history`, `/api/history/:id` | Playground history (`playground-history.json` in the schema dir) |
| `GET` | `/api/execute/status` | Execute provider, `enabled`, `disabledReason`, connection/driver readiness, `timeoutMs`, `maxRows` |
| `POST` | `/api/execute` | Run a validated SELECT (opt-in; `403` when `studio.execute.enabled` is false) |
| `POST` | `/api/execute/install-driver` | Install the configured driver package (loopback only; execute must be enabled) |

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
- **Setup config writer:** every value interpolated into the generated `askdb.config.ts` is emitted with `JSON.stringify` (the file is later executed via jiti); env names must match `^[A-Z][A-Z0-9_]*$`, and paths reject control characters. `askdb init` uses the same escaping.
- **Request bodies:** `readJson` rejects bodies over 1 MiB (`MAX_JSON_BODY_BYTES`) with `413`: early on a declared `Content-Length`, otherwise while streaming (the rest of the body is drained, not buffered).
- **Playground history:** `POST /api/history` copies only the known `PlaygroundHistoryEntry` fields, with type and length checks. `id`/`timestamp` are server-assigned. Before writing `playground-history.json`, Studio makes sure the schema dir's `.gitignore` lists it. If there's no `.gitignore`, Studio writes one that also ignores `.env`, `.env.*`, and `!.env.example` (the plan-043 rules; the `.env` rules are skipped when the schema dir is the project root). If a `.gitignore` exists, Studio only appends the entry. Failures are non-fatal.
- **Driver install:** the requested provider must be an own key of `EXECUTE_DRIVER_REGISTRY` (`Object.hasOwn`, so `constructor`/`__proto__` → `400`). The package manager is spawned through `packageManagerSpawnSpec` (`src/package-manager.ts`, shared with the setup wizard): `shell: false` on POSIX, and `shell: true` on Windows (Node can't spawn `.cmd` shims without a shell) with every argument matched against a strict allowlist pattern.

### Execute

Execute is opt-in (`studio.execute.enabled`, default `false`). When disabled, `POST /api/execute` and `/api/execute/install-driver` return `403` with instructions, and `/api/execute/status` reports `enabled: false` plus `disabledReason`, so the Playground hides the Execute button. The execute connection is `studio.execute.databaseUrl` / `file`. The introspection connection is reused only with `studio.execute.useIntrospectionConnection: true`. `askdb init` and the setup wizard write `enabled: true` when the user chooses Studio execute. Both default to off.

Each request (`apps/studio/src/server.ts` `executeQuery` → `apps/studio/src/execute-registry.ts`):

1. `validateExecuteSql` runs `@askdb/core` `validateSelectSql` with the provider's `DialectSpec`. A same-family `dialect` override is honored: `cockroachdb` on postgres, `mariadb` on mysql. A `SqlValidationError` becomes a `400`, and the driver is never called. The normalized single statement is what gets executed.
2. When the schema marks anything `sensitive`, `validateSensitiveReferences` runs in `"warn"` mode, and matches come back as `warnings` on a successful response. Studio has no strict setting.
3. The engine runner executes one statement read-only, with a timeout (`studio.execute.timeoutMs`, default 30000) and a row cap (`studio.execute.maxRows`, default 500; fetch `maxRows + 1`, respond with `truncated`/`rowLimit`):

| Engine | Single statement | Read-only | Timeout | Row cap |
|---|---|---|---|---|
| Postgres | `queryMode: "extended"` + named statement (never the simple protocol) | `SET default_transaction_read_only = on`; `BEGIN READ ONLY` … `ROLLBACK` | `SET LOCAL statement_timeout`; `query_timeout` backstop | `SELECT * FROM (…) AS askdb_q LIMIT n+1` |
| MySQL / MariaDB | `execute()` (binary prepared protocol); `multipleStatements: false` | `SET SESSION TRANSACTION READ ONLY`; `START TRANSACTION READ ONLY` … `ROLLBACK` | `MAX_EXECUTION_TIME` (MariaDB: `max_statement_time`); connection destroyed on client backstop | `SELECT * FROM (…) AS askdb_q LIMIT n+1` |
| SQLite | `better-sqlite3` `prepare()` rejects multiple statements; non-reader statements rejected | `readonly: true, fileMustExist: true` | Not enforced (`timeout` is lock wait only; queries run synchronously) | `.iterate()` stops at `n+1` |
| SQL Server | Validation only (T-SQL batches allow several statements) | `SET XACT_ABORT ON; BEGIN TRANSACTION; … ROLLBACK` (no read-only mode; use a read-only login) | `request.cancel()` after `timeoutMs` | `SET ROWCOUNT n+1` |

These guards narrow the blast radius. They don't replace a read-only database role.

## Test bar

- `pnpm --filter @askdb/studio build` succeeds; server TypeScript to `dist/`; React client to `dist/client/`.
- `@askdb/studio` depends on `@askdb/enrich` for all workspace logic (package assertion).
- API contract tests: each endpoint returns the documented shape; error responses include typed `code`.
- Schema editing: `POST /api/tables/:tableId` saves draft and reloads workspace from disk; reloading Studio shows saved values.
- AI suggestion: `POST /api/suggest` returns candidates; missing AI config returns a typed config error, not a 500.
- RAG: `POST /api/rag/index` builds index with mock or configured embedder; `POST /api/rag/query` returns scored chunks.
- Ask: `POST /api/ask` returns SQL and warnings; works with `ASKDB_MOCK_SQL` without a live model.
- Request guard: spoofed `Host` → `403`; cross-origin POST → `403`; `text/plain` POST → `415`/`403`; missing or wrong token → `403`; served `index.html` contains the token.
- Execute: disabled by default → `403`; enabled + validated SELECT runs (real SQLite); `SELECT 1; DROP TABLE t` → `400` before the driver; row cap truncates with `truncated: true`; no silent reuse of the introspection connection; Postgres uses extended query mode inside `BEGIN READ ONLY`; SQL Server wraps in `BEGIN TRANSACTION`/`ROLLBACK` (mocked drivers).
- Request bodies over 1 MiB → `413`. History stores only whitelisted fields and git-ignores `playground-history.json`. `install-driver` with `constructor` → `400`.
- Setup writer: quotes/backslashes in paths round-trip as literal strings; control characters and invalid env names are rejected.
- Package tarball includes `bin`, server dist, client dist, README, LICENSE.
- Manual: `askdb-studio --schema fixtures/schemas/orders-users.schema` — browse tables, edit a description, save, confirm file updated, reload, confirm value persists.
