---
"@askdb/core": minor
"askdb": patch
---

**@askdb/core**: promote the sensitive-identifier SQL check out of the CLI into core as a public, enforceable API, and fix its false-positive problem.

New export `validateSensitiveReferences(sql, schema, options?)` reports the `sensitive` tables and columns a SQL statement references, returning `{ passed, references, unresolvedScope? }` — the same shape as `TenantGuardrailResult`. Each reference carries `matchKind: "qualified" | "unqualified" | "table"`. `{ mode: "strict" }` throws the new `SensitiveReferenceError extends AskDbError` with a `SensitiveReferenceRuleCode`; `{ mode: "warn" }` (the default) returns without throwing.

`sensitive: true` was previously prompt-level only — `formatSchemaForNlToSql` tags or withholds identifiers, which constrains what the model *sees* but not SQL that reaches execution by another route (a host SQL cache, a replayed statement, a regenerated artifact). `validateSensitiveReferences` is the enforcement path and is exported standalone so it can run on stored SQL with no model in the loop.

**Fixes the unqualified matcher.** The CLI's private implementation regex-tested each sensitive column name anywhere in the statement, so any table-level-`sensitive` table with a common column (`id`, `name`, `tag`) flagged every benign query. Unqualified names now count only when the owning table is actually in the statement's scope: `FROM`/`JOIN` targets and their aliases are resolved first, including inside CTEs and derived tables, and string literals and comments are excluded. When scope cannot be proven the check fails conservatively and says why via `unresolvedScope`, mirroring how `validateTenantGuardrails` handles unprovable scope.

`ask()` runs the guardrail over the SQL it returns and attaches `AskPipelineResult.sensitiveGuardrail`; the new `AskPipelineOptions.sensitiveGuardrailMode` selects `"warn"` (default — not a breaking change), `"strict"`, or `"off"`. Reuses the existing `askdb.pipeline.sensitive_sql_warning` log event, now exposed as `AskDbLogEvent.PipelineSensitiveSqlWarning`. Also exports `schemaHasSensitiveIdentifiers` and `formatSensitiveReference`.

**askdb**: `askdb ask` now renders the guardrail result from `ask()` instead of its own private copy of the check, so there is one implementation. The warning no longer fires on unrelated queries that merely share a column name with a sensitive table, and schema-qualified schemas now print `schema.table.column`. Unresolvable statement scope is surfaced as a `Note:` line.
