# ADR 0001: Structured logging with Pino

## Status

Accepted

## Date

2026-05-06

## Context

Phase 2 introduces **structured logging** and **trace / correlation IDs** across headless surfaces (CLI first; MCP and HTTP later), per [`docs/roadmap.md`](../roadmap.md) and [`docs/specs/phase-2-hardening-modes/requirements.md`](../specs/phase-2-hardening-modes/requirements.md).

AskDB needs:

- **JSON-first** logs so CI, log aggregators, and tests can parse lines reliably.
- **Configurable destinations** — integrators must choose where logs go (e.g. **stderr** during interactive CLI use, **stdout** for piping, **files** for retention) without relying only on shell redirection.
- **Multiple sinks** without blocking the event loop where possible (e.g. log to stderr and a file in one run).
- **Stable field names** for correlation IDs and pipeline stages so behavior stays consistent when we add Phase 3 servers wrapping the same `@askdb/core` entrypoints.

The stack is **Node.js** and **TypeScript** ([`docs/platform.md`](../platform.md)); we want one logger abstraction reused by CLI today and route handlers or MCP hosts tomorrow.

## Decision

Use **[Pino](https://github.com/pinojs/pino)** as the structured logging library for `@askdb/core` (and CLI wiring).

**Implementation expectations:**

- Instantiate loggers via a **small factory** in core so transports and base fields (e.g. `correlationId`) stay centralized.
- Prefer Pino’s **`pino.transport()`** pattern with multiple targets when more than one destination is required ([transports documentation](https://github.com/pinojs/pino/blob/master/docs/transports.md)).
- Optional **`pino-pretty`** for human-readable dev output only; production and CI paths remain **newline-delimited JSON**.
- **Convention:** primary CLI **result** stream stays on **stdout**; **diagnostic logs** default to **stderr** when both apply, so piping query output remains predictable.

## Alternatives considered

### Winston

**Pros:** Very mature; familiar multi-transport API; large ecosystem.

**Cons:** Heavier and slower on hot paths than Pino; JSON output is workable but less uniform than Pino’s default **one JSON object per line**, which we want as the contract for parsers and tests.

**Outcome:** Rejected for new code where JSON-lines performance and consistency matter.

### Roarr

**Pros:** Structured, grep-friendly; minimal philosophy aligned with strict logging.

**Cons:** Smaller ecosystem for **multi-destination** setups and Node CLI patterns; integrators and docs examples are less ubiquitous than Pino for transports and tooling.

**Outcome:** Rejected — acceptable product, weaker fit for documented multi-sink Phase 2 requirements.

### consola

**Pros:** Excellent ergonomics for CLI-style unified console output.

**Cons:** Not optimized for **strict JSON lines everywhere**; weaker fit when we need worker-thread **transports** (file + stderr) without bespoke glue.

**Outcome:** Rejected as the primary structured logger; could remain useful for unrelated UX elsewhere, but not as the observability contract.

### Ad hoc `console` / manual JSON

**Pros:** Zero dependency.

**Cons:** No standard transports, levels, or child loggers; multi-destination and testing become custom and error-prone.

**Outcome:** Rejected.

## Consequences

### Positive

- Fast JSON logging with a **single clear line format** for tests and aggregators.
- First-class **multi-target** logging via official Pino transports.
- Aligns with common Node production practice, easing onboarding for contributors and integrators.

### Negative / trade-offs

- **Dependency:** Adds `pino` (and likely `pino-pretty` as a dev dependency if we pretty-print locally).
- **Learning curve:** Contributors must follow our factory and field conventions; documented in Phase 2 implementation and `README.md`.
- **Transport worker threads:** Pino’s recommended transport path uses workers; we must verify behavior in constrained environments (e.g. minimal CI) and document any constraints.

## References

- [`docs/specs/phase-2-hardening-modes/requirements.md`](../specs/phase-2-hardening-modes/requirements.md) — Phase 2 logging requirements and destination configuration  
- [`docs/specs/phase-2-hardening-modes/plan.md`](../specs/phase-2-hardening-modes/plan.md) — Milestone 1 observability tasks  
- [Pino](https://github.com/pinojs/pino) — project repository  
- [Pino transports](https://github.com/pinojs/pino/blob/master/docs/transports.md) — multi-destination setup  
