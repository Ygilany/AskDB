# Phase 1 — Schema in, SQL out (CLI), tabular results

## Context

AskDB turns natural language into **schema-grounded SQL** with execution and reporting, with **trust-first** defaults and a **developer-first embed** story ([`docs/mission.md`](../../mission.md)).

For implementation discipline, the platform baseline is **TypeScript**, **pnpm + Turborepo**, a **monorepo** layout, and **Postgres-first** execution when a live database is used ([`docs/platform.md`](../../platform.md)). Phase 1 establishes the first vertical slice on that baseline.

## Problem

Teams need a fast, reproducible way to go from a **known schema description** and a **natural-language question** to **validated SQL** and **tabular query results** on **PostgreSQL**, without building a web app or MCP server first.

## Scope (in)

Aligned with **Phase 1** in [`docs/roadmap.md`](../../roadmap.md):

- Accept **one** supported schema description format end-to-end — **AskDB schema JSON v1** (see [`fixtures/schemas/README.md`](../../../fixtures/schemas/README.md)); no multi-format matrix in Phase 1.
- **Natural language → SQL** with guardrails appropriate for **local / dev** use (validation, safety checks, clear failures—no claim of production multi-tenant policy yet).
- **Execute** generated SQL against a **configured Postgres** instance and return **tabular results** (rows/columns; no rich report builder).
- **CLI** as the first user surface (iteration speed, no UI coupling).

### Testing strategy (in scope for this phase’s spec)

Phase 1 delivery is **not** “code only”—it includes an explicit **testing and fixtures** story:

- **Fixtures:** Stable, small schema artifacts and golden / snapshot-friendly examples for generation and validation tests.
- **Unit tests:** Parser/schema normalization, SQL validation helpers, and pure generation boundaries (with LLM calls mocked or behind a test double where needed).
- **Integration tests:** At least one path that runs against **real PostgreSQL** (local or CI service container) to prove connection, execution, and result shape.

Observability (structured logging, trace IDs) is **deferred** to later roadmap work; [`docs/roadmap.md`](../../roadmap.md) Phase 2 now tracks that explicitly.

## Out of scope

As in Phase 1 of the roadmap:

- Embeddable UI, non-Postgres engines, full RAG, sensitive-field registry UI, production-grade multi-tenant policy engine, user-run introspection templates (later phases).

## Decisions / open choices

| Topic | Decision |
|--------|-----------|
| Monorepo package split | Separate **core** library from **CLI** package early; keeps MCP/API alignment later (`platform.md`). |
| Schema format | **AskDB schema JSON v1** — `{ "version": 1, "tables": [...] }` with columns `name`, `type`, optional `nullable` / `primaryKey` (fixtures under `fixtures/schemas/`). |
| LLM / keys | **BYO** API keys (`mission.md`, `platform.md`); no centralized vendor requirement. |
| Safety posture | Optimize for **dev honesty**: block obvious foot-guns; document limitations vs. production governance. |

## Success (product)

A developer can, from this repo:

1. Install/build the CLI in a documented way.
2. Point at a schema artifact + Postgres config.
3. Ask a natural-language question and receive **validated SQL** and **tabular results** or a **clear error** explaining what failed (schema mismatch, unsafe SQL, connection, etc.).

## References

- [`docs/mission.md`](../../mission.md) — audience, modes, principles  
- [`docs/platform.md`](../../platform.md) — stack and connectivity assumptions  
- [`docs/roadmap.md`](../../roadmap.md) — phase ordering  
