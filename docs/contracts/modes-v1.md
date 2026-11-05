# AskDB operating modes — contract v1

This document fixes **trust boundaries** for headless pipelines (CLI today; MCP/HTTP later): what may enter **model context** beyond the AskDB schema and natural-language question.

**Execution:** AskDB returns SQL and does not execute it. Hosts that run generated SQL own the read-only role, transaction, and audit controls.

---

## Modes shipped in v1

| Mode | ID | Model sees (NL→SQL call) | Row data → model |
|------|-----|--------------------------|------------------|
| **Schema-grounded only** | `schema_only` | Schema artifact + NL question only (via NL→SQL prompt). | **Never.** AskDB does not run the SQL, so it has no rows; results the host produces stay with the host. |
| **Schema + bounded results (reserved)** | `bounded_results` | Same as `schema_only`. | **Contract:** a future step may let a host send a **bounded** subset of its own results back through the model for summaries; bounded limits and UX are specified when that step lands. **Today:** `ask()` behaves exactly as in `schema_only`: one NL→SQL model call, no row payloads, and no extra log event. |

**Default:** `schema_only`.

**Sensitive metadata:** NL→SQL DDL **includes** sensitive identifiers by default (tagged `(sensitive)`); optional omission is configurable. **Stripping sensitive columns before any summary LLM** and related rules are in [**`sensitive-fields-and-modes.md`**](./sensitive-fields-and-modes.md).

---

## Out of scope for v1 (reserved names / roadmap)

Product copy in [`README.md`](../../README.md) describes additional modes (**report shape**, **full AI-assisted reporting**). Those are **not selectable** in the CLI/engine v1 contract; behaviour is unspecified until later phases.

---

## Enforcement (v1 implementation)

1. **`schema_only`** — The pipeline **must not** pass query **row payloads** into `generateText` / chat completion. AskDB never executes SQL, so no row payloads exist inside the pipeline in v1; this mode **requires** keeping that invariant if a result-summary step is ever added.
2. **`bounded_results`** — Same invariant for the **NL→SQL** call. v1 has no summary step; any future one **must** respect documented **row/column/byte budgets** before it ships.

---

## Selection

Hosts pass **`AskDbModeV1`** (see `@askdb/core` exports):

- Config: **`modes.askdbMode`** in `askdb.config.*` (unset: `schema_only`). `@askdb/client`, the CLI and the HTTP API read it, and treat it as the **loosest** mode a run gets ([ADR 0025](../adrs/0025-config-mode-is-the-loosest-a-call-gets.md)).
- Per run: CLI `--mode <schema_only|bounded_results>`, `createAskDb().ask(q, { mode })`, or the HTTP request's `mode` / `x-askdb-mode`. A per-run mode can tighten the config mode to `schema_only`, never loosen it; a looser request runs at the config mode, with no error.
- Core: **`ask({ ..., mode })`** reads no config; the caller's `mode` is final (default `schema_only`).

Structured logs emit **`askdb.pipeline.mode`** (with a `mode` field) at pipeline start, before the NL→SQL call. No other log event depends on the mode.

---

## References

- [`docs/mission.md`](../mission.md) — trust-first analytics, explicit bounded data  
- [`docs/specs/modes-and-observability.md`](../specs/modes-and-observability.md) — modes and observability feature spec  
- [`docs/integration/reuse-core-phase-3.md`](../integration/reuse-core-phase-3.md) — stable `ask()` surface for MCP/HTTP  
- [`docs/contracts/sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) — sensitive DDL defaults, optional omission, bounded summaries  
