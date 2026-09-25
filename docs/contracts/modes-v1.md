# AskDB operating modes — contract v1

This document fixes **trust boundaries** for headless pipelines (CLI today; MCP/HTTP later): what may enter **model context** beyond the AskDB schema and natural-language question.

**Execution:** `ask()` returns SQL and never executes it; the CLI and HTTP API do not execute generated SQL either. Hosts that run generated SQL own the read-only role, transaction, and audit controls (see [`docs/mission.md`](../mission.md)). Studio's optional Playground execute is off by default; when enabled it validates each query as a single read-only SELECT and runs it in a read-only transaction (SQL Server: an always-rolled-back transaction) with a timeout and row cap (`apps/studio/src/execute-registry.ts`). `@askdb/postgres`'s catalog query runner (`packages/postgres/src/exec/postgres.ts`) wraps connector-owned introspection SQL in `BEGIN READ ONLY` and is never used for generated SQL.

---

## Modes shipped in v1

| Mode | ID | Model sees before SQL runs | Row data → model after execute |
|------|-----|----------------------------|----------------------------------|
| **Schema-grounded only** | `schema_only` | Schema artifact + NL question only (via NL→SQL prompt). | **Never.** Results are for the host/CLI output only. |
| **Schema + bounded results (stub)** | `bounded_results` | Same as `schema_only` for the **first** model call. | **Contract:** a future step may attach a **bounded** subset for summaries; bounded limits and UX are specified when that step lands. **Today:** pipeline logs a **`post_execute` stub branch** (`branch: stub`) and performs **no** second LLM call with row payloads. |

**Default:** `schema_only`.

**Sensitive metadata:** NL→SQL DDL **includes** sensitive identifiers by default (tagged `(sensitive)`); optional omission is configurable. **Stripping sensitive columns before any summary LLM** and related rules are in [**`sensitive-fields-and-modes.md`**](./sensitive-fields-and-modes.md).

---

## Out of scope for v1 (reserved names / roadmap)

Product copy in [`README.md`](../../README.md) describes additional modes (**report shape**, **full AI-assisted reporting**). Those are **not selectable** in the CLI/engine v1 contract; behaviour is unspecified until later phases.

---

## Enforcement (v1 implementation)

1. **`schema_only`** — After successful execute, the engine **must not** invoke any code path that passes query **row payloads** into `generateText` / chat completion (no such path exists in v1; this mode **requires** continuing to satisfy that invariant).
2. **`bounded_results`** — Same invariant for the **NL→SQL** call. Post-execute, only the **stub** branch runs (logging); any real summary step **must** respect documented **row/column/byte budgets** before it is marked non-stub.

---

## Selection

Hosts pass **`AskDbModeV1`** (see `@askdb/core` exports):

- CLI: `--mode <schema_only|bounded_results>` or env **`ASKDB_MODE`** (see [`README.md`](../../README.md)).
- Library: **`ask({ ..., mode })`**.

Structured logs emit **`askdb.pipeline.mode`** at pipeline start and **`askdb.pipeline.post_execute`** after execute when rows were produced.

---

## References

- [`docs/mission.md`](../mission.md) — trust-first analytics, explicit bounded data  
- [`docs/specs/modes-and-observability.md`](../specs/modes-and-observability.md) — modes and observability feature spec  
- [`docs/integration/reuse-core-phase-3.md`](../integration/reuse-core-phase-3.md) — stable `ask()` surface for MCP/HTTP  
- [`docs/contracts/sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) — sensitive DDL defaults, optional omission, bounded summaries  
