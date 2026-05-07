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

---

## When users ask about sensitive columns

With the **default** (names included, tagged), the model sees real identifiers and can usually produce valid SQL shapes when the question references those columns.

With **omission** mode, the model may **not** see withheld identifiers and may invent names or fail—mitigations include turning omission off, UI clarification, or detection of unknown tokens in the question vs. visible DDL.

---

## Open design: post-generation warnings for sensitive projections

**Future work:** After SQL is generated (and optionally validated), the pipeline could attach a **host-visible warning** if the query **selects or computes on** columns marked sensitive—regardless of whether names were omitted or listed in the prompt—so operators review before trusted execution.

This is **not** implemented in modes v1; it requires explicit contract updates (field names, UX, tests).

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
- [`docs/specs/phase-2-hardening-modes/requirements.md`](../specs/phase-2-hardening-modes/requirements.md)
- [`docs/integration/reuse-core-phase-3.md`](../integration/reuse-core-phase-3.md) — avoid duplicating prompt/validation policy in wrappers
- [`fixtures/schemas/README.md`](../../fixtures/schemas/README.md) — `sensitive` in schema JSON
