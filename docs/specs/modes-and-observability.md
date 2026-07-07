# Feature: Modes and Observability

**Status:** Complete  
**Packages:** `@askdb/core` (logging factory, modes, sensitive-field handling), `askdb` (CLI surface)

## Overview

This feature establishes the cross-surface contracts that all AskDB surfaces share: operating modes, structured logging, correlation IDs, and sensitive-field handling. Every surface — CLI, HTTP API, Studio — reuses the same logging factory and respects the same mode semantics.

Operating modes define what data may reach the model and what the pipeline is allowed to do. Structured logging provides a stable, parseable event stream for integrators, CI, and debugging. Sensitive-field handling ensures that columns marked sensitive appear in prompts in a controlled way and trigger host-visible warnings when referenced in generated SQL.

## Scope

### In scope

- **Operating modes contract** (`modes-v1`) — `schema_only` (no row data reaches the model) and `bounded_results` (optional second model pass with explicit row budget and sensitive columns projected out). Contract: [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md)
- **Structured logging** — Pino-backed logging factory in `@askdb/core`; JSON lines by default; configurable destinations (stderr, file, stdout); optional `pino-pretty` for dev only. See [ADR 0001](../adrs/0001-structured-logging-pino.md)
- **Correlation IDs** — generated per run; propagated through all pipeline events; overridable via env for integrators
- **Sensitive-field metadata** — schema columns marked `sensitive` are included in NL→SQL DDL tagged `(sensitive)` by default; optional omission mode withholds them entirely; describable-layer fields (descriptions, aliases, enum) are excluded for sensitive columns in prompt assembly
- **Post-SQL sensitive warnings** — when generated SQL references sensitive-marked columns, a structured warning event and a human-readable CLI warning are emitted (non-blocking)
- **CI spawn tests** — deterministic CLI subprocess tests using `ASKDB_MOCK_SQL` that assert stable log field names and event presence without a live LLM

### Out of scope

- `bounded_results` full implementation (non-stub second model pass with row projection) — tracked in Phase 12
- MCP or HTTP-specific log transports — each surface owns its own wiring; the factory is shared
- Audit logging or compliance output formats

## Design decisions

- **Pino over Winston or consola** — JSON-lines-first, multi-target via official transports, fast on hot paths. See [ADR 0001](../adrs/0001-structured-logging-pino.md) for full alternatives analysis.
- **stdout for results, stderr for logs** — CLI result output (SQL, tabular rows) goes to stdout; diagnostic logs default to stderr. This keeps piping predictable.
- **Stable event taxonomy** — event names (`askdb.pipeline.started`, `askdb.pipeline.generation_completed`, etc.) are a versioned contract. Additive events are allowed; renames are breaking.
- **Sensitive identifiers included by default** — identifiers are needed for NL→SQL grounding; omitting them by default degrades SQL quality. The `omitSensitiveIdentifiersFromPrompt` option enables stricter deployments. Describable-layer fields (descriptions, aliases) are always excluded for sensitive columns regardless of this flag.
- **Counts-only logging for sensitive fields** — structured logs emit counts of sensitive columns excluded/included, never column names or values.

## Contracts and API surface

**Modes contract:** [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md)  
**Sensitive fields contract:** [`docs/contracts/sensitive-fields-and-modes.md`](../contracts/sensitive-fields-and-modes.md)

```ts
// Logging factory (packages/core/src/logging/)
createAskDbLogger(options: AskDbLoggerOptions): AskDbLogger

interface AskDbLoggerOptions {
  level?: string
  destinations?: LogDestination[]   // stderr | stdout | file path
  pretty?: boolean                   // dev only; never sole production path
  correlationId?: string
}

// Mode selection
type AskMode = 'schema_only' | 'bounded_results'

// Sensitive handling in ask()
interface AskOptions {
  omitSensitiveIdentifiersFromPrompt?: boolean
}
```

Required log fields on every record: `event`, `correlationId`, `level`, `time`

Required events for a complete pipeline run:
- `askdb.pipeline.started`
- `askdb.pipeline.generation_started` / `askdb.pipeline.generation_completed`
- `askdb.pipeline.validation_result`
- `askdb.pipeline.completed` / `askdb.pipeline.failed`
- `askdb.sensitive.columns_tagged` (counts only, when sensitive columns present)
- `askdb.sql.sensitive_reference_warning` (when generated SQL references sensitive columns)

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Spawn test: CLI subprocess with `ASKDB_MOCK_SQL` and `--log-file <tmp>` produces valid JSONL; every record has `event` and `correlationId`; required events all appear.
- Drift guard: tests fail if any required log field is missing or renamed; additive fields are allowed.
- Mode contract: `schema_only` and `bounded_results` produce observable behavioral differences (prompt context, execution gating) verifiable without a live model.
- Sensitive field defaults: a fixture schema with sensitive columns produces DDL with identifiers tagged `(sensitive)` by default; enabling `omitSensitiveIdentifiersFromPrompt` removes them entirely.
- Post-SQL warning: a fixture that generates SQL referencing a sensitive column emits `askdb.sql.sensitive_reference_warning` under the run's `correlationId`.
- Log destination: logs routed to a temp file path appear in that file with the same JSON structure as stderr output.
- `pino-pretty` is never the sole output path; tests confirm JSON output works independently of pretty-print being enabled.
