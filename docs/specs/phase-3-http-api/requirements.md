# Phase 3 — Second surface (minimal HTTP API)

See also **[`plan.md`](./plan.md)** (milestones) and **[`validation.md`](./validation.md)** (merge bar).

## Context

AskDB optimizes for **trust-first analytics** and **developer-first embed**: schema-grounded generation, explicit boundaries when data touches the model, and one core reused across multiple surfaces ([`docs/mission.md`](../../mission.md)).

Phase 1 shipped the CLI loop. Phase 2 established cross-surface contracts (modes, correlation IDs, logging). Phase 3 adds a **minimal HTTP API** surface that reuses `@askdb/core` and keeps behavior aligned with the CLI and contracts ([`docs/platform.md`](../../platform.md), [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md)).

## Problem

Integrators want a server surface to:

- call AskDB from web apps and internal services without shelling out to a CLI
- standardize request/response shapes for multiple consumers
- preserve **Phase 2 semantics** (modes, boundaries, correlation IDs, structured logs) across non-CLI environments

## Scope (in)

- **Minimal HTTP API** (Node runtime) as a second surface.
- **Reuse core**: server calls the same underlying `ask()` flow/types from `@askdb/core` (no forked logic).
- **Versioned-ish contract**: stable request/response JSON shapes documented in this spec and covered by tests.
- **Correlation IDs**: accept an inbound correlation ID (header) and/or generate one; return it in the response and logs.
- **Modes**: expose Phase 2 modes in the HTTP API (request field and/or header); enforce boundaries as per the contract.
- **Structured errors**: stable error codes/types for common failure classes (invalid schema, invalid question, SQL rejected, execution disabled, execution failure).
- **Docs + examples**: simple curl or node example showing a full request/response.

## Out of scope

- Shipping an MCP server surface (explicit follow-on phase in [`docs/roadmap.md`](../../roadmap.md)).
- Web UI, schema catalog UX, embed components (Phase 4).
- Non-Postgres engines (later phases).
- Auth/tenancy policy engine beyond “integrator owns deployment boundaries” (Phase 9 depth later).

## Spec decisions (from planning)

| Topic | Decision |
|-------|----------|
| Surface for Phase 3 | **HTTP API first** |
| Spec folder name | **`docs/specs/phase-3-http-api/`** |
| Merge bar | **Integration-ready** — versioned contract, examples, and tests proving parity on key flows |

## Design constraints (from mission/platform)

- **Same core, many surfaces**: transport packages should be thin wrappers; core logic stays in `@askdb/core`.
- **Trust boundaries**: do not expand what data can reach a model vs. what Phase 2 modes already allow.
- **BYO secrets**: API keys and DB connectivity remain integrator-owned; server must not require AskDB-owned credentials.
- **Postgres-first**: execution assumptions remain Postgres when enabled.

## Open choices (to resolve during implementation)

- Endpoint shape: single `/ask` vs. multiple endpoints (e.g. `/validate`, `/execute`) while still mapping to one core flow.
- Execution: whether HTTP surface supports execution at all in Phase 3, or is “generate + validate only” with execution remaining CLI-only for now (must still preserve mode semantics).
- Header names for correlation and mode selection (align with existing contracts where possible).

## HTTP contract (current)

This spec intentionally keeps the HTTP surface **thin**. Implementation lives in `packages/http-api/`.

### Endpoints

- `GET /health` → `200 { "ok": true }`
- `POST /ask` → generates SQL (and only executes when explicitly enabled)

### Headers

- `x-correlation-id` (optional): if provided, echoed back in responses and used in logs
- `x-askdb-mode` (optional): mode id (body `mode` wins if present)
- `x-askdb-execute` (optional): boolean (body `execute` wins if present)

### Environment variables (server-side)

- `OPENAI_API_KEY`: required for NL→SQL generation (unless using mock SQL)
- `ASKDB_MOCK_SQL`: when set, bypasses live model calls and returns deterministic SQL
- `ASKDB_SCHEMA_PATH`: path to an AskDB schema JSON v1 file used as the server default
- `ASKDB_SCHEMA_JSON`: inline AskDB schema JSON v1 string used as the server default (prefer `ASKDB_SCHEMA_PATH`)
- `ASKDB_MODE`: default mode when neither request body nor header sets it
- `ASKDB_HTTP_ENABLE_EXECUTION`: must be truthy to allow execution requests (otherwise `/ask` returns `403 execution_disabled`)
- Logging: `ASKDB_LOG_LEVEL`, `ASKDB_LOG_FILE`, `ASKDB_LOG_STDOUT`

### Request body (`POST /ask`)

```json
{
  "question": "How many users are there?",
  "schemaJson": "{...AskDB schema JSON v1... (optional override)}",
  "mode": "schema_only",
  "execute": false,
  "connectionString": "postgres://…",
  "explain": false,
  "omitSensitiveFromPrompt": false
}
```

### Success response

```json
{
  "ok": true,
  "correlationId": "demo-123",
  "sql": "select …",
  "result": { "columns": ["…"], "rows": [["…"]] },
  "explain": { "...": "..." }
}
```

### Error response envelope

```json
{
  "ok": false,
  "correlationId": "demo-123",
  "error": { "code": "bad_request", "message": "…" }
}
```

Error codes are **stable** and include (non-exhaustive): `not_found`, `bad_request`, `schema_parse_error`, `generation_not_configured`, `execution_disabled`, `sql_validation_error` (includes `rule`), `sql_generation_error`, `sql_execution_error`, `internal_error`.

### Examples

See `packages/http-api/README.md` for curl + Node examples.

