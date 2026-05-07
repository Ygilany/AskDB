# Phase 2 — Hardening and “modes” as contracts

See also **[`README.md`](./README.md)** (spec index), **[`plan.md`](./plan.md)** (milestones), and **[`validation.md`](./validation.md)** (Phase 2 merge bar).

## Context

AskDB’s north star couples **trust-first analytics** with **developer-first embed**: schema-grounded generation, explicit boundaries when data touches the model, and one core reused across CLI, MCP, HTTP, and web ([`docs/mission.md`](../../mission.md)).

Phase 1 proved the **Postgres + CLI** loop with AskDB schema JSON v1, BYO keys, and dev-appropriate guardrails. Phase 2 **encodes product semantics** before additional surfaces ship: observability, **modes** as explicit contracts, stronger SQL and UX around ambiguity, and early **sensitive-field** handling in metadata—aligned with **Phase 2** in [`docs/roadmap.md`](../../roadmap.md).

Technically, the baseline stays **TypeScript**, **pnpm + Turborepo**, **monorepo** packages, and **Postgres-first** execution ([`docs/platform.md`](../../platform.md)). Headless surfaces should not depend on the web stack; logging and IDs must be reusable when MCP or a minimal API lands in Phase 3.

## Problem

Without shared **contracts** and **correlation**, integrators and future surfaces cannot debug runs consistently, reason about **what data the model may see**, or enforce **sensitive-field** rules in prompts and (later) RAG. Phase 2 makes those semantics **explicit and testable** while improving SQL validation and user-facing clarity when schema or intent is ambiguous.

## Scope (in)

All Phase 2 roadmap pillars are **in scope** with **balanced** emphasis—no single pillar is deferred as “later within the phase”; ordering is handled via **demoable milestones** in [`plan.md`](./plan.md).

1. **Observability** — Structured logging and **trace / correlation IDs** across headless flows (**CLI first**), designed so MCP/HTTP can adopt the same fields without rewiring semantics. Integrators must be able to **choose where logs go** (for example **stderr** for interactive terminals, **stdout** for piping, or a **file path** for audits)—see **Logging library and destinations** below.
2. **Modes as contracts** — Document and implement **operating modes** (e.g. schema-only execution vs. optional second pass with **bounded** result data for summaries), aligned with mission language on explicit, bounded, user-controlled data exposure.
3. **SQL quality and UX** — Improve validation, explainability hooks where useful, and prompts/errors when schema or NL intent is ambiguous—still **Postgres-centered** dialect assumptions ([`docs/platform.md`](../../platform.md)).
4. **Sensitive fields (plumbing)** — Introduce **sensitive-field exclusions** in **metadata handling** (schema artifact / normalized model path) as early scaffolding for prompt safety and future RAG; not a full registry UI.

## Out of scope

Per roadmap: **Second surface** (MCP vs HTTP) as a shipped product (Phase 3), **web / catalog / embed** (Phase 4), user-run introspection templates (Phase 5), **non-Postgres** engines (Phase 6), full **RAG** (Phase 7), reports beyond tables (Phase 8), production-grade multi-tenant policy depth (Phase 9).

Phase 2 may add **types or internal APIs** that Phase 3 will call, but routing, auth, and transport for MCP/API are explicitly out.

## Spec decisions (from planning)

| Topic | Decision |
|--------|-----------|
| Phase 2 pillar balance | **Balanced** — all four roadmap bullets in scope together; sequencing via demoable milestones, not deferring an entire pillar. |
| Plan shape | **`plan.md`** uses **numbered task groups** where each group ends in something **demoable / shippable** ([`plan.md`](./plan.md)). |
| Merge evidence | **`validation.md`** requires **CI green** plus **fixtures or golden-output** coverage where behavior is **contract-heavy** (modes, logging shape, sensitive-field stripping from prompt context). |
| Logging library | **Pino** — see **Logging library and destinations** for rationale and alternatives considered. |
| Log destinations | **Configurable** — users choose one or more sinks (e.g. stderr default for CLI, optional file, optional duplicate to stdout) via CLI flags and/or environment variables documented in `README.md`. Primary machine-readable format **JSON lines** (Pino’s default line stream). |

## Logging library and destinations

**Requirement:** Logging must support **configurable output targets** so interactive use (logs on **stderr**, primary CLI/table output on **stdout**), **piping**, **CI capture**, and **file-based** retention are all first-class without ad-hoc shell-only workarounds.

**Selection: [Pino](https://github.com/pinojs/pino)** as the Node.js structured logger for `@askdb/core` / CLI wiring. Formal rationale and alternatives are recorded in [**ADR 0001 — Structured logging with Pino**](../../adrs/0001-structured-logging-pino.md).

| Option | Notes |
|--------|--------|
| **Pino** | **Chosen.** Fast, JSON-first, widely used in Node services and CLIs; built-in **transport** model supports multiple destinations (e.g. `pino/file` to a path, stdout/stderr via file descriptors, optional pretty-print for humans in dev). Fits “stable fields + correlation ID” and Phase 3 reuse (same logger factory in HTTP/MCP later). |
| **Winston** | Mature transports and multiple transports out of the box; heavier and slower than Pino for hot paths; JSON story is fine but less uniform than Pino’s single-line JSON default. |
| **Roarr** | Structured and grep-friendly; smaller ecosystem than Pino for transports and CLI patterns; less default guidance for multi-destination setups teams already know from Pino. |
| **consola** | Great for CLI UX and unified console API; weaker fit for **strict JSON lines** everywhere and **worker-thread transports** when we need file + stderr without blocking the event loop. |

Implementation detail (non-normative): Pino’s recommended approach for multiple sinks is **`pino.transport()` with multiple targets** ([transports documentation](https://github.com/pinojs/pino/blob/master/docs/transports.md)); exact wiring stays in code review.

**Convention:** Keep **primary user-facing query/table output** on **stdout** and route **diagnostic logs** to **stderr** by default when both apply, so `askdb … \| jq` (or similar) stays predictable when logging is enabled.

## Open choices (to resolve during implementation)

- Exact **mode** names and CLI flags/env vs. single config artifact.
- Exact **CLI flags / env names** for log level, destinations, and optional **pino-pretty** in development (library chosen; naming still open).
- Mandatory **log field** names for correlation IDs (stable contract once shipped).
- Minimum **explainability** surface (CLI text only vs. structured sidecar for future API).
- How **sensitive fields** are represented in schema JSON v1 (additive optional fields vs. companion doc)—prefer **additive** where possible.

## Sensitive fields — behavior beyond Phase 2 plumbing

Phase 2 **lists** sensitive column/table names in NL→SQL DDL by default (tagged), with optional **omission** for stricter deployments; debug logs use **counts only**. **`bounded_results`** rules for **stripping sensitive columns before row data hits an LLM** and future **post-SQL warnings** are documented in [**`docs/contracts/sensitive-fields-and-modes.md`**](../../contracts/sensitive-fields-and-modes.md).

## Success (product)

After Phase 2:

1. An integrator can run the CLI (and later analogous headless callers) with **consistent structured logs**, **configurable log destinations**, and a **correlation ID** tying one user question through generation, validation, and optional execution.
2. **Modes** are **documented and enforced** so it is obvious whether result rows may enter model context and under what bounds.
3. **Ambiguous** schema or questions yield **clearer** validation and prompts instead of opaque failures—without claiming domain correctness without human review ([`docs/mission.md`](../../mission.md)).
4. **Sensitive** columns/tables marked in metadata are **represented safely** in NL→SQL prompt construction (default: identifiers listed with `(sensitive)` tags; optional omission mode for stricter deployments), with tests proving both behaviors.

## References

- [`README.md`](./README.md) — Phase 2 spec index (cross-links plan, validation, contracts)  
- [`plan.md`](./plan.md), [`validation.md`](./validation.md)  
- [`docs/mission.md`](../../mission.md) — modes, trust, BYO keys, same core/many surfaces  
- [`docs/platform.md`](../../platform.md) — monorepo, Postgres-first, headless vs web UI  
- [`docs/roadmap.md`](../../roadmap.md) — Phase 2 definition and ordering  
- [`docs/contracts/sensitive-fields-and-modes.md`](../../contracts/sensitive-fields-and-modes.md) — sensitive metadata vs. models and bounded results  
