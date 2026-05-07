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

