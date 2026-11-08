# Sensitive fields, NL→SQL prompts, and modes

This document captures **product and engineering intent** for how **sensitive** table/column metadata interacts with **models**, **operating modes**, and **user requests**. It complements:

- [`modes-v1.md`](./modes-v1.md) — what may reach the model today (v1 contract)
- Phase 2 implementation — schema JSON `sensitive` flags and NL→SQL DDL formatting (`packages/core` prompt assembly)

---

## Current behavior (Phase 2 plumbing)

- Schema JSON may mark tables/columns **`sensitive`** (additive optional fields).
- Table markdown front-matter (`tables/<table>.md`, written by Studio's Sensitivity controls via `@askdb/enrich`) may **escalate** sensitivity: table-level `sensitive: true` or `columns[].sensitive: true` marks the table/column sensitive on top of `schema.json`. Front-matter is **escalate-only** — `sensitive: false` never un-marks a table or column that is sensitive anyway (via `schema.json`, a sensitive parent table, or another front-matter entry's `sensitive: true`); the loader ignores it and emits a `sensitivity_downgrade_ignored` warning. A column ID listed in another table's markdown still escalates the column it names when it sets `sensitive: true` (nothing else in that entry is applied), and the loader emits a `misplaced_column_id` warning naming the file and the owning table. When several entries name the same column (repeated in one file, or across files), the column is sensitive if any of them sets `sensitive: true`; a repeat within one file also emits a `duplicate_column_id` warning, and only the first entry's other fields apply. Two table markdown files with the same front-matter `id` are a load error. Every surface below (prompt DDL, RAG chunks, `validateSensitiveReferences`) reads the resulting effective flag from the normalized schema. See [`schema-v2.md` → Sensitive propagation](./schema-v2.md#sensitive-propagation).
- **Default NL→SQL prompt DDL** **includes** sensitive **identifiers** (column names, types, nullability) so the model can **ground** SQL and avoid inventing non-existent columns. Sensitive columns are tagged **`(sensitive)`** on each line so the model and operators can treat them as high-risk metadata—not secret values.
- **Optional stricter policy:** hosts or CLI may **omit** sensitive identifiers from the DDL entirely (`omitSensitiveIdentifiersFromNlToSqlPrompt` / `--omit-sensitive-from-prompt` / `modes.omitSensitiveFromPrompt` in `askdb.config.ts`, which you can bind to a variable of your choosing with `env("…")`). Omission also withholds describable text that names a sensitive column (a description, an alias, a column's enum values or note, common query language, business context, a concept, a retrieved example question or tenant policy chunk), and a foreign-key line with a sensitive column or table on either side, so the name doesn't reach the model through prose; a sensitive table keeps a one-line stub with its name ([`schema-v2.md` → Sensitive propagation](./schema-v2.md#sensitive-propagation), [ADR 0022](../adrs/0022-omission-withholds-mentions-in-prompts.md)). That reduces name exposure to the first LLM call but increases the risk of **hallucinated** column names when users ask about those fields. Config `modes.omitSensitiveFromPrompt: true` is a floor: a per-call or per-request `true` can tighten a single call, but `false` can't loosen the operator's setting The `@askdb/client` facade enforces the floor, so the CLI and the HTTP API, which both call it, apply it the same way.
- **Studio's AI tenant-policy draft** (`POST /api/suggest-tenant-policy`) follows the same rule: it lists tables and columns from the normalized schema with `formatSchemaV2ForNlToSql`, so sensitive columns are tagged by default and withheld when `modes.omitSensitiveFromPrompt` is on. It sends no describable-layer text (descriptions, aliases, common query language), and it lists a foreign key only when both of its columns are listed. When omission withholds a primary or foreign key, the draft's `warnings` name it, because the draft can't scope through a column the model never saw. See [ADR 0021](../adrs/0021-tenant-policy-draft-follows-ask-sensitivity.md).
- **Debug logs:** counts only — `askdb.prompt.sensitive_identifiers_listed` when names are included (default), or `askdb.prompt.sensitive_redacted` when omission mode is active. Its `mentionDroppedCount` counts the describable texts withheld across the whole schema; with a retriever, `askdb.pipeline.retrieval_used` carries the retrieval prompt's own `mentionDroppedCount`.

**Values** from the database are never placed in the NL→SQL prompt; only schema metadata appears there. Execution safety and access control remain separate concerns.

**Tagging and omission are prompt-level only.** Both act on what the model *sees*. Neither constrains SQL that reaches execution by another route — a host's SQL cache, a replayed or stored statement, a schema artifact regenerated with the flags reset, or a model naming a column it was never shown. For that, see the enforcement path below.

---

## Which prompts follow omission

`modes.omitSensitiveFromPrompt` is a floor for every prompt AskDB sends to a language model, not only `ask()`'s. `ask()` and `suggestEnrichment()` read no config, so each host passes the setting in.

| Model call | How it follows the setting |
| --- | --- |
| `ask()` through `@askdb/client`, the CLI and the HTTP API | The facade passes `omitSensitiveIdentifiersFromNlToSqlPrompt` (above). |
| Studio's Playground (`POST /api/ask`) | Studio passes `omitSensitiveIdentifiersFromNlToSqlPrompt: true` to `ask()` when the setting is on. |
| Studio's tenant-policy draft (`POST /api/suggest-tenant-policy`) | Lists the schema with `formatSchemaV2ForNlToSql` (above; [ADR 0021](../adrs/0021-tenant-policy-draft-follows-ask-sensitivity.md)). |
| Studio's enrichment suggestions (`POST /api/suggest`) | `suggestEnrichment()` takes `omitSensitiveIdentifiersFromPrompt` and lists the target table with `formatSchemaV2ForNlToSql`, from `loadSchema()`'s effective flags: its types take `NormalizedV2Table`, not a raw `schema.json` table. Sensitive columns are tagged by default and withheld under omission, and a sensitive table keeps its name. A suggestion for a sensitive column is refused under omission with `SensitiveEnrichmentTargetError` (Studio answers 400), because the prompt would have to name it. The prompt carries no describable text. |

Embedding calls (building a RAG index) don't read the setting: the chunker leaves sensitive tables, sensitive columns and text that names them out of the index by default, whatever the mode, unless `includeSensitiveDescribable: true` opts in ([`schema-v2.md` → Sensitive propagation](./schema-v2.md#sensitive-propagation)).

**The one exception: the tenant policy block.** When a schema has a tenant policy, `ask()` always adds its block to the prompt ([`tenant-policy.md` → Always injected](./tenant-policy.md#always-injected-not-chunked)). Under omission the block still names every column the policy front-matter lists for the tables the prompt shows (scope columns, join-path columns, polymorphic type and id columns, root id columns), sensitive ones included, because the tenant check requires the model to filter on them. It names no table marked `tracked: false`, and no table left out by retrieval except on a join path a shown table needs ([ADR 0038](../adrs/0038-prompt-hints-name-no-schema-table.md)). Withholding them would make the tenant check reject the SQL for every sensitive tenant-scoped table. The block names identifiers, never values. See [ADR 0026](../adrs/0026-every-prompt-follows-omission.md).

---

## When users ask about sensitive columns

With the **default** (names included, tagged), the model sees real identifiers and can usually produce valid SQL shapes when the question references those columns.

With **omission** mode, the model may **not** see withheld identifiers and may invent names or fail—mitigations include turning omission off, UI clarification, or detection of unknown tokens in the question vs. visible DDL.

---

## Enforcement path: `validateSensitiveReferences`

`@askdb/core` exports `validateSensitiveReferences(sql, schema, options?)` — the **enforcement** counterpart to the prompt-level flags above. It inspects a SQL string against the schema artifact and reports the `sensitive` tables/columns it can see the statement referencing — sensitive columns named explicitly (qualified or unqualified) and sensitive tables used as a `FROM`/`JOIN` target — regardless of whether the names were tagged, omitted, or never shown to a model at all. Wildcards (`SELECT *`, `t.*`) and whole-row references count as referencing every sensitive column of the table they reach (see below).

```ts
import { validateSensitiveReferences } from "@askdb/core";

const { passed, references, unresolvedScope } = validateSensitiveReferences(cachedSql, schema);
```

**Result shape** (mirrors `TenantGuardrailResult`):

| Field | Meaning |
| --- | --- |
| `passed` | `true` only when nothing sensitive was referenced **and** table scope was fully resolved. |
| `references` | `{ table, schema?, column, matchKind }[]`. `matchKind` is `"qualified"` (`t.col` / `alias.col`, `alias.*`, or a whole-row reference like `row_to_json(alias)`), `"unqualified"` (bare `col`, or a bare `SELECT *` over an in-scope table), or `"table"` (a `sensitive` table reached as a `FROM`/`JOIN` target; `column` is `"*"`). |
| `unresolvedScope` | Present when scope could not be proven: `{ issues, widened, message }`. |

**Modes.** `{ mode: "warn" }` (default) returns references without throwing — the behavior the CLI has always had. `{ mode: "strict" }` throws `SensitiveReferenceError extends AskDbError` carrying a `SensitiveReferenceRuleCode` (`SENSITIVE_TABLE_REFERENCED`, `SENSITIVE_COLUMN_REFERENCED`, `UNRESOLVED_TABLE_SCOPE`).

**Scope resolution.** An unqualified column name counts **only when the owning table is actually in the statement's scope**. `FROM`/`JOIN` targets and their aliases (including inside CTEs and derived tables) are resolved first, then unqualified names are matched against the columns of those tables. A bare-word scan would flag `id` on every query the moment any table-level-`sensitive` table has an `id` column; this does not.

**Wildcards and whole rows.** `SELECT *`, `alias.*`, and a table name or alias used as a value (`row_to_json(u)`, `to_jsonb(u)`, `json_agg(u)`, Postgres `SELECT u FROM users u`) reach every column of that table, so they are reported as referencing each of its sensitive columns. `SELECT *` still counts after the engine's `SELECT` modifiers (`DISTINCT`, Postgres `DISTINCT ON (…)`, MySQL `DISTINCTROW` / `HIGH_PRIORITY` / `SQL_NO_CACHE` / …, SQL Server `TOP n [PERCENT] [WITH TIES]`); without a dialect, every engine's modifiers are accepted. `count(*)`, multiplication, and `EXISTS (SELECT * …)` are not wildcards. An output alias — `SELECT id AS u` or `SELECT id u` — names a result column and is not a reference; `SELECT u` and `SELECT id, u` are.

Wildcards and whole-row references expand per query block. Each `SELECT` is a block — subqueries, derived tables, CTE bodies, `EXISTS` / `IN` operands, and each `UNION` / `INTERSECT` / `EXCEPT` branch — and a bare `*` reaches only the tables in its own block's `FROM`/`JOIN`: `SELECT * FROM orders WHERE EXISTS (SELECT 1 FROM users)` does not reach `users`. A derived table or CTE is reported through its own body, so `SELECT * FROM (SELECT * FROM users) s` is still reported. An `alias.*` or whole-row alias resolves in its own block first, then outward through enclosing blocks, so a correlated `row_to_json(u)` reaches the outer `users u`, while an outer `u.*` is not confused with a subquery's `users u`; an alias no enclosing block binds is matched against every binding in the statement. When the block structure cannot be read with confidence — unbalanced parentheses, an unterminated token, a `FROM` outside every `SELECT`, or two `SELECT`s at one depth with no set operator — wildcards and whole-row references expand against every table in the statement. Explicit column references are not scoped this way; they are matched against every table the statement reaches.

**Lexing.** The statement is split by the same dialect-aware lexer as `validateSelectSql`, so a column cannot hide behind an engine-specific quote rule (Postgres `E'\''`, MySQL `'\''`, Postgres `ARRAY['a]']`). Pass `{ dialect }` (a `DialectSpec` or `{ id }`) for an exact reading. Without it, table scope is resolved under a dialect-neutral reading and references are unioned across every built-in engine's reading that lexes cleanly — conservative, so it can over-report in rare cases. MySQL `"…"` is read as an identifier, as it is on `ANSI_QUOTES` servers, so `SELECT "ssn"` is reported rather than passed as a string.

**SQLite's quoted names.** Where the SQL may be read as SQLite (sqlite, a custom `AskDialect` or id, or no dialect), a `'…'` in a table's place is the table's name, as SQLite reads it: right after `FROM`, `JOIN` or `IN`, after a `,` in a `FROM` list, or beside a `.`. So `SELECT * FROM 'users'` reaches every sensitive column of `users`.

**Conservative failure.** When scope cannot be resolved — no resolvable table source (`NO_TABLE_SOURCE`), a qualifier bound to nothing known (`UNKNOWN_QUALIFIER`), a table source that is not a relation name (`OPAQUE_TABLE_SOURCE`), a string/quoted identifier/comment that never closes (`UNTERMINATED_TOKEN`), a name the check can't match as written (`UNICODE_ESCAPED_IDENTIFIER`: when the SQL may be read as Postgres, a Unicode-escaped name, which Postgres decodes; under `sqlserver`, a custom `AskDialect` or id, or no dialect, a name, quoted or not, that holds a character outside printable ASCII and that the schema doesn't spell exactly, which SQL Server's collation may read as another name, so `[ｓｓｎ]` reads `ssn`), or, when the SQL may be read as Postgres, an `E'…'` string continued on a later line (`STRING_CONTINUATION`), which Postgres reads differently from the check (#707), or a `b'…'` byte string with a backslash or a continuation (`ESCAPED_BYTE_STRING`), which CockroachDB reads differently (#730) — the check reports `unresolvedScope` rather than passing silently, and for the first two it widens unqualified matching to every sensitive column. `strict` mode treats unresolved scope as a failure: `passed` is `false`, so it throws `SensitiveReferenceError` (`rule: "UNRESOLVED_TABLE_SCOPE"` when no sensitive reference was found).

**In the pipeline.** `ask()` runs the check on the model's SQL before rendering it (its bound `sql` and its `sql-unbound` template; [ADR 0010](../adrs/0010-sql-guardrail-decision-point.md)), reports the findings in `AskPipelineResult.verdict`, and derives `AskPipelineResult.sensitiveGuardrail` from them. `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default), `"strict"`, or `"off"`. The check is skipped entirely when the schema declares no `sensitive` markers, so `sensitiveGuardrail` is absent in that case.

**On rebind.** `bindPreparedQuery(prepared, values, { schema, sensitiveGuardrailMode? })` (and `@askdb/client`'s `askdb.bind()`) runs the check again on the stored template, under the schema and mode given at bind time. `"warn"` binds and reports the references in `BoundQuery.verdict` on every rebind; `"strict"` throws `SensitiveReferenceError`. Hosts that rebind through it don't need to call `validateSensitiveReferences` themselves.

**Hosts that store and replay SQL by another route must call it on every execution**, not just at generation time: a stored `sql` string run again, or SQL from anywhere but `ask()` and `bindPreparedQuery()`. The function is exported standalone for that: it takes SQL and a schema, with no model in the loop.

**Logs:** `askdb.pipeline.sensitive_sql_warning` with `sensitiveColumnCount` and the matched `sensitiveColumns` — schema metadata only, never row values. Emitted in both `warn` and `strict` modes.

**Limits.** The check is heuristic, not a SQL parser, and defaults to `warn`. It can miss a table written in a FROM form it doesn't bind, so a wildcard over that table goes unreported. Known open cases: a parenthesized FROM item such as `SELECT * FROM (users)` ([#306](https://github.com/Ygilany/AskDB/issues/306)), a comma-joined table after a JOIN's `ON`/`USING` condition ([#307](https://github.com/Ygilany/AskDB/issues/307)), MySQL `STRAIGHT_JOIN` used as a join operator ([#308](https://github.com/Ygilany/AskDB/issues/308)), and Postgres `TABLE users` inside a derived table ([#309](https://github.com/Ygilany/AskDB/issues/309)). It is a review/enforcement aid and defense in depth, not a security boundary and not a substitute for database-side column privileges.

---

## `bounded_results` and row data → model

**Contract direction** ([`modes-v1.md`](./modes-v1.md)): AskDB does not execute SQL, so no v1 path sends **row payloads** to a model; `bounded_results` reserves a future summary step over results the host provides.

**Intended rules when bounded summaries are implemented:**

1. **No implicit shipping of result rows to the model.** Row data must not enter model context unless the user (or host integration) **explicitly requests** a summary / second-pass step that is documented and gated.
2. When result rows **are** allowed to be sent for summarization, **all sensitive columns must be removed** (or replaced with safe placeholders) **before** any LLM call that consumes row payloads—consistent with schema `sensitive` markers and any future row-level policy.
3. **Ordering:** strip/redact **first**, then apply **budget** limits (row count, columns, bytes) as specified in the bounded-results contract.

Validation and tests for this belong in the milestone that ships result summarization, not in v1.

---

## References

- [`docs/contracts/modes-v1.md`](./modes-v1.md)
- [`docs/specs/modes-and-observability.md`](../specs/modes-and-observability.md)
- [`docs/integration/reuse-core-phase-3.md`](../integration/reuse-core-phase-3.md) — avoid duplicating prompt/validation policy in wrappers
- [`fixtures/schemas/README.md`](../../fixtures/schemas/README.md) — `sensitive` in schema JSON
- [`docs/contracts/schema-v2.md`](./schema-v2.md#sensitive-propagation) — effective sensitivity (escalate-only front-matter overrides)
