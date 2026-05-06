# Phase 2 — Hardening and modes (spec index)

Structured specs for observability, operating modes, SQL UX, sensitive-field plumbing, and documentation continuity.

| Doc | Purpose |
|-----|---------|
| [`plan.md`](./plan.md) | Demoable milestones and task-group order |
| [`requirements.md`](./requirements.md) | Scope, decisions, logging rationale |
| [`validation.md`](./validation.md) | **Merge bar**: CI plus fixture/golden expectations |

**Contracts**

- [`docs/contracts/modes-v1.md`](../../contracts/modes-v1.md) — `schema_only` vs `bounded_results`
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive metadata in prompts and summaries
- [`docs/integration/reuse-core-phase-3.md`](../../integration/reuse-core-phase-3.md) — stable `@askdb/core` surfaces for MCP/HTTP wrappers

Related: [**ADR 0001 — Structured logging with Pino**](../../adrs/0001-structured-logging-pino.md).
