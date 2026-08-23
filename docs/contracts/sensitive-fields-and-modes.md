# Sensitive fields, NL→SQL prompts, and modes

This document captures **product and engineering intent** for how **sensitive** table/column metadata interacts with **models**, **operating modes**, and **user requests**. It complements:

- [`modes-v1.md`](./modes-v1.md) — what may reach the model today (v1 contract)
- Phase 2 implementation — schema JSON `sensitive` flags and NL→SQL DDL formatting (`packages/core` prompt assembly)

---

## Current behavior (Phase 2 plumbing)

- Schema JSON may mark tables/columns **`sensitive`** (additive optional fields).
- **Default NL→SQL prompt DDL** **includes** sensitive **identifiers** (column names, types, nullability) so the model can **ground** SQL and avoid inventing non-existent columns. Sensitive columns are tagged **`(sensitive)`** on each line so the model and operators can treat them as high-risk metadata—not secret values.
- **Optional stricter policy:** hosts or CLI may **omit** sensitive identifiers from the DDL entirely (`omitSensitiveIdentifiersFromNlToSqlPrompt` / `--omit-sensitive-from-prompt` / `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`). That reduces name exposure to the first LLM call but increases the risk of **hallucinated** column names when users ask about those fields.
- **Debug logs:** counts only — `askdb.prompt.sensitive_identifiers_listed` when names are included (default), or `askdb.prompt.sensitive_redacted` when omission mode is active.

**Values** from the database are never placed in the NL→SQL prompt; only schema metadata appears there. Execution safety and access control remain separate concerns.

**Tagging and omission are prompt-level only.** Both act on what the model *sees*. Neither constrains SQL that reaches execution by another route — a host's SQL cache, a replayed or stored statement, a schema artifact regenerated with the flags reset, or a model naming a column it was never shown. For that, see the enforcement path below.

---

## When users ask about sensitive columns

With the **default** (names included, tagged), the model sees real identifiers and can usually produce valid SQL shapes when the question references those columns.

With **omission** mode, the model may **not** see withheld identifiers and may invent names or fail—mitigations include turning omission off, UI clarification, or detection of unknown tokens in the question vs. visible DDL.

---

## Enforcement path: `validateSensitiveReferences`

`@askdb/core` exports `validateSensitiveReferences(sql, schema, options?)` — the **enforcement** counterpart to the prompt-level flags above. It inspects a SQL string against the schema artifact and reports every `sensitive` table/column it references, regardless of whether the names were tagged, omitted, or never shown to a model at all.

```ts
import { validateSensitiveReferences } from "@askdb/core";

const { passed, references, unresolvedScope } = validateSensitiveReferences(cachedSql, schema);
```

**Result shape** (mirrors `TenantGuardrailResult`):

| Field | Meaning |
| --- | --- |
| `passed` | `true` only when nothing sensitive was referenced **and** table scope was fully resolved. |
| `references` | `{ table, schema?, column, matchKind }[]`. `matchKind` is `"qualified"` (`t.col` / `alias.col`), `"unqualified"` (bare `col`), or `"table"` (a `sensitive` table reached as a `FROM`/`JOIN` target; `column` is `"*"`). |
| `unresolvedScope` | Present when scope could not be proven: `{ issues, widened, message }`. |

**Modes.** `{ mode: "warn" }` (default) returns references without throwing — the behavior the CLI has always had. `{ mode: "strict" }` throws `SensitiveReferenceError extends AskDbError` carrying a `SensitiveReferenceRuleCode` (`SENSITIVE_TABLE_REFERENCED`, `SENSITIVE_COLUMN_REFERENCED`, `UNRESOLVED_TABLE_SCOPE`).

**Scope resolution.** An unqualified column name counts **only when the owning table is actually in the statement's scope**. `FROM`/`JOIN` targets and their aliases (including inside CTEs and derived tables) are resolved first, then unqualified names are matched against the columns of those tables. A bare-word scan would flag `id` on every query the moment any table-level-`sensitive` table has an `id` column; this does not.

**Conservative failure.** When scope cannot be resolved — no resolvable table source (`NO_TABLE_SOURCE`), a qualifier bound to nothing known (`UNKNOWN_QUALIFIER`), or a table source that is not a relation name (`OPAQUE_TABLE_SOURCE`) — the check reports `unresolvedScope` rather than passing silently, and for the first two it widens unqualified matching to every sensitive column. `strict` mode treats unresolved scope as a failure, mirroring how `validateTenantGuardrails` handles unprovable scope.

**In the pipeline.** `ask()` runs the guardrail over the SQL it is about to return and attaches the result as `AskPipelineResult.sensitiveGuardrail`. `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default), `"strict"`, or `"off"`. The check is skipped entirely when the schema declares no `sensitive` markers, so `sensitiveGuardrail` is absent in that case.

**Hosts that cache or replay SQL must call it on every execution**, not just at generation time. The function is exported standalone precisely for that: it takes SQL and a schema, with no model in the loop.

**Logs:** `askdb.pipeline.sensitive_sql_warning` with `sensitiveColumnCount` and the matched `sensitiveColumns` — schema metadata only, never row values. Emitted in both `warn` and `strict` modes.

**Limits.** The check is heuristic, not a SQL parser. It is a review/enforcement aid, not a substitute for database-side column privileges.

---

## `bounded_results` and row data → model

**Contract direction** ([`modes-v1.md`](./modes-v1.md)): post-execute paths that send **row payloads** to a model are **stubbed** in v1 (logging only).

**Intended rules when bounded summaries are implemented:**

1. **No implicit shipping of result rows to the model.** Row data must not enter model context unless the user (or host integration) **explicitly requests** a summary / second-pass step that is documented and gated.
2. When result rows **are** allowed to be sent for summarization, **all sensitive columns must be removed** (or replaced with safe placeholders) **before** any LLM call that consumes row payloads—consistent with schema `sensitive` markers and any future row-level policy.
3. **Ordering:** strip/redact **first**, then apply **budget** limits (row count, columns, bytes) as specified in the bounded-results contract.

Validation and tests for this belong in the milestone that ships real post-execute summarization, not in the v1 stub-only phase.

---

## References

- [`docs/contracts/modes-v1.md`](./modes-v1.md)
- [`docs/specs/modes-and-observability.md`](../specs/modes-and-observability.md)
- [`docs/integration/reuse-core-phase-3.md`](../integration/reuse-core-phase-3.md) — avoid duplicating prompt/validation policy in wrappers
- [`fixtures/schemas/README.md`](../../fixtures/schemas/README.md) — `sensitive` in schema JSON
