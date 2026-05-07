# Phase 2.5 — Trust UX warnings + CI spawn tests (requirements)

This spec implements a subset of **Phase 2.5** from [`docs/roadmap.md`](../../roadmap.md): reduce manual validation and tighten developer/operator trust UX **before** new surfaces (MCP/HTTP, web).

Guidance:

- Mission: [`docs/mission.md`](../../mission.md) — **trust-first analytics** + **developer-first embed**
- Platform: [`docs/platform.md`](../../platform.md) — Turbo/pnpm, Postgres-first reference bar, schema-first flows
- Contracts: **do not change** `modes-v1` semantics; this work should be additive and regression-safe

## Goal

Make AskDB easier to trust and operate by:

1. **Shrinking manual validation** with **CI spawn tests** that assert stable structured logs (`event`, `correlationId`, etc.) **without** needing a live LLM.
2. Improving **trust UX** for integrators via:
   - **Richer CLI errors** (include schema path / fixture hints where relevant).
   - **Post-SQL warnings** when generated SQL references **sensitive**-marked columns (host-visible; does not block execution by default).

## In scope

### 1) CI spawn tests (no live LLM)

- Add tests that execute the `askdb` CLI as a subprocess and validate:
  - **JSON Lines** output to the configured log sink (prefer file sink for deterministic capture).
  - Stable presence of core fields (at minimum): `event`, `level`, `timestamp` (or `time`), and `correlationId`.
  - The run includes a minimal expected sequence of events (start → generation/validation branch → end) without over-constraining message text.
- Tests must run **without** real model credentials:
  - Use a **mock provider** / stubbed NL→SQL step, or a deterministic local provider path already supported by `@askdb/core`.
  - Ensure the test still exercises the same CLI pipeline wiring (args parsing, logger configuration, correlation propagation).

### 2) Richer CLI errors

- When schema ingestion/validation fails, CLI errors should:
  - Reference the **schema file path** provided by the user (when applicable).
  - Offer **actionable** hints (e.g., “Try `fixtures/...`” or “expected AskDB schema JSON v1 shape”) without dumping full schema contents.
- When query intent is ambiguous or schema coverage is insufficient (pre-check failures), errors should:
  - Name the **category** of failure (e.g. unknown table, unknown column, ambiguous reference).
  - Suggest next steps (e.g. verify table name, enrich schema, provide alias/synonym if that feature exists later).

### 3) Post-SQL sensitive-column warnings

- If a generated SQL statement references columns marked **sensitive** in schema metadata, surface a warning intended for the host/integrator:
  - Prefer a **structured log event** (stable `event` name) and a **human-readable CLI warning** (stderr).
  - Warning should identify **which** sensitive columns were referenced when allowed by the contract (identifiers only; never values).
  - Ensure the warning mechanism works whether or not execution happens (it’s about the SQL text).

## Out of scope

- Changing the meaning of “modes” or adding new mode variants (see [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md)).
- New surfaces (MCP/HTTP) or web UI (Phase 3/4).
- Full `bounded_results` summarization or any feature that sends row payloads to an LLM (future phases).
- Multi-engine database support (later roadmap phases).

## Decisions (recorded up front)

- **Branch & spec name**: `phase-2-5-trust-ux-warnings`
- **Merge bar**: “high”
  - Docs + spawn test(s) + mock-provider E2E coverage
  - A guard against accidental **log schema drift** (test fails when required fields/events disappear)
- **Warnings are non-blocking** by default
  - Execution policy remains the integrator’s responsibility (mission: accountability/policy lives with the deploying team).

## Success criteria (high level)

- A CI job can run `askdb` in a subprocess with a mock provider and assert:
  - stable log fields
  - stable correlation ID propagation
  - stable event taxonomy (at least for the covered path)
- CLI errors include file-path context and actionable hints for common failure modes.
- Sensitive-column warnings appear reliably (and predictably) when SQL references sensitive-marked columns.

## References

- Roadmap Phase 2.5 bullets: [`docs/roadmap.md`](../../roadmap.md)
- Mission principles: [`docs/mission.md`](../../mission.md)
- Platform baseline: [`docs/platform.md`](../../platform.md)
- Modes contract: [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md)
- Sensitive fields contract notes: [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md)

