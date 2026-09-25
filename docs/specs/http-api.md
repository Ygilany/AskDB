# Feature: HTTP API

**Status:** Complete  
**Packages:** `apps/http-api` (`@askdb/http-api`)

## Overview

The HTTP API is a thin server surface over `@askdb/core`. It exposes `ask()` over HTTP so consumers can call AskDB from web apps and internal services without shelling out to the CLI. It shares the same mode semantics, correlation ID propagation, structured logging, and sensitive-field rules as the CLI — no logic is duplicated from core.

Schema is server-configured (`host.schemaPath` / `host.schemaJson`, or the `--schema-path` flag) rather than sent on every request. Per-request schema overrides are off by default and must be enabled with `httpApi.allowSchemaOverride` (for tests and trusted callers only).

## Scope

### In scope

- `POST /ask` — accepts question, mode, correlation ID; returns SQL, usage, and the sensitive-identifier guardrail result
- Server-configured schema (path via config); opt-in per-request schema override (`httpApi.allowSchemaOverride`)
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

**Request** (`POST /ask`, JSON body):
```json
{
  "question": "string (required)",
  "mode": "schema_only | bounded_results (optional; header x-askdb-mode also accepted, body wins)",
  "explain": false,
  "omitSensitiveFromPrompt": false,
  "schemaJson": "optional bundled schema artifact — only when httpApi.allowSchemaOverride is true"
}
```

Correlation ID comes from the `x-correlation-id` header, or is generated.

- **Mode** is parsed up front with core's `parseAskDbModeV1`. Invalid values return `400 bad_request`. With no request mode, config `modes.askdbMode` applies, then `schema_only`.
- **Sensitive prompt handling:** config `modes.omitSensitiveFromPrompt` is a floor. The request flag can tighten it (`true`) but not loosen it. The floor is enforced in the `@askdb/client` facade, so every `createAskDb()` host gets the same behavior.
- **Schema overrides** are rejected with `403 schema_override_disabled` unless `httpApi.allowSchemaOverride: true` (default `false`). An override lets any caller put arbitrary schema text into the prompt through the operator's model key.
- **Timeout:** the model call gets an `AbortSignal` that fires after `httpApi.requestTimeoutMs` (default `60000`). It is passed through `createAskDb().ask({ abortSignal })` to `generateText`.

**Success response (`200`):**
```json
{
  "ok": true,
  "correlationId": "string",
  "sql": "string",
  "explain": null,
  "usage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
  "sensitiveGuardrail": { "passed": true, "references": [] }
}
```

`sensitiveGuardrail` is present only when the schema marks something `sensitive`. It passes core's `AskPipelineResult.sensitiveGuardrail` through unchanged.

**Error response:**
```json
{
  "ok": false,
  "correlationId": "string",
  "error": { "code": "string", "message": "string", "rule": "optional string" }
}
```

**Status codes.** The status is chosen from the error type (`instanceof`, with a `name` fallback), never from message text:

| Code | HTTP | Source |
| --- | --- | --- |
| `bad_request` | 400 | Malformed body, missing `question`, invalid `mode`, non-string `schemaJson`, retired execution field, `SchemaNotConfiguredError`, `DialectNotSupportedError` |
| `schema_parse_error` | 400 | `SchemaLoadError` |
| `sql_validation_error` | 400 | `SqlValidationError` (with `rule`) |
| `schema_override_disabled` | 403 | `schemaJson` sent while `httpApi.allowSchemaOverride` is off |
| `not_found` | 404 | Unknown route |
| `payload_too_large` | 413 | Body over `maxBodyBytes` |
| `guardrail_violation` | 422 | `SensitiveReferenceError`, `TenantGuardrailError` (with `rule`) |
| `generation_not_configured` | 500 | `ModelNotConfiguredError` |
| `internal_error` | 500 | Anything else. The message is generic. |
| `sql_generation_error` | 502 | `SqlGenerationError` (provider failure or timeout). The message is generic. |

Provider error text is never returned to clients, because it can echo request details or credential fragments. Every `/ask` failure after body parsing is logged server-side as `askdb.run.error` with the status, code, error name, message, cause, and (for `5xx`) the stack, under the response's `correlationId`.

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Success response shape matches the contract (required fields present, correct types).
- Error response shape is stable (`code`, `message`, `correlationId` always present).
- Correlation ID propagation: accepted inbound ID echoed in response; generated when absent.
- Mode selection: request mode field wires through to core; different modes produce observable differences matching the modes contract.
- CLI parity: for a fixture schema + `dev.mockSql`, the HTTP surface returns the same SQL as the CLI for the same input.
- Model-provider failures return `502` with a generic message (no provider text) and are logged. Unmapped errors return a generic `500`.
- Config `modes.omitSensitiveFromPrompt: true` can't be loosened by the request flag.
- `schemaJson` is rejected by default and accepted when `httpApi.allowSchemaOverride` is `true`.
- Structured logs include `correlationId` and Phase 2-aligned event fields on every request.
- Manual: run server locally; execute the documented curl examples; confirm JSON response and structured stderr logs.
