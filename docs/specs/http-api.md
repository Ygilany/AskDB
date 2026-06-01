# Feature: HTTP API

**Status:** Complete  
**Packages:** `apps/http-api` (`@askdb/http-api`)

## Overview

The HTTP API is a thin server surface over `@askdb/core`. It exposes `ask()` over HTTP so consumers can call AskDB from web apps and internal services without shelling out to the CLI. It shares the same mode semantics, correlation ID propagation, structured logging, and sensitive-field rules as the CLI — no logic is duplicated from core.

Schema is server-configured (loaded at startup from a path or env variable) rather than sent on every request. Per-request schema overrides are supported for tests and special cases only.

## Scope

### In scope

- `POST /ask` — accepts question, mode, correlation ID; returns SQL, warnings, and metadata
- Server-configured schema (path via config/env); per-request schema override for test use
- Mode selection via request field, wired through to `@askdb/core`
- Correlation ID: accepted from inbound header/field or generated; echoed in response
- Structured logging reusing Phase 2 log factory — same event names, same `correlationId` per request
- Stable error response shape with typed `code` field and consistent HTTP status codes
- `GET /health` endpoint

### Out of scope

- SQL execution — the HTTP API returns SQL only; callers execute against their own database
- Authentication and authorization — host responsibility
- WebSocket or streaming responses
- MCP server surface — see Phase 14 in roadmap

## Design decisions

- **Thin wrapper, no duplicated logic** — all NL→SQL orchestration, validation, mode enforcement, and sensitive handling runs through `@askdb/core`. The HTTP layer handles request parsing, response shaping, and HTTP-specific concerns only.
- **Server-configured schema** — sending the full schema JSON on every request is expensive and error-prone. The server loads the schema at startup. Per-request overrides exist for testing scenarios.
- **Same contracts as CLI** — modes, correlation IDs, log events, and sensitive-field warnings are identical to the CLI surface. A consumer that understands the CLI contracts understands the HTTP API.

## Contracts and API surface

**Request:**
```json
POST /ask
{
  "question": "string",
  "mode": "schema_only | bounded_results",
  "correlationId": "optional string",
  "schema": "optional override for tests"
}
```

**Success response:**
```json
{
  "sql": "string",
  "warnings": [],
  "correlationId": "string"
}
```

**Error response:**
```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  },
  "correlationId": "string"
}
```

HTTP status codes: `200` success, `400` caller errors (bad request, validation failure), `500` server faults.

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Success response shape matches the contract (required fields present, correct types).
- Error response shape is stable (`code`, `message`, `correlationId` always present).
- Correlation ID propagation: accepted inbound ID echoed in response; generated when absent.
- Mode selection: request mode field wires through to core; different modes produce observable differences matching the modes contract.
- CLI parity: for a fixture schema + `ASKDB_MOCK_SQL`, the HTTP surface returns the same SQL as the CLI for the same input.
- Structured logs include `correlationId` and Phase 2-aligned event fields on every request.
- Manual: run server locally; execute the documented curl examples; confirm JSON response and structured stderr logs.
