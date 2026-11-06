# ADR 0038 — The NL→SQL prompt's hints name no schema table

## Status

Accepted (2026-11-06), for #677. The coordinator chose the option below in the #677 thread. Implemented in PR #804.

## Context

`ask()` adds deterministic hints to the NL→SQL prompt when the question and the schema look misaligned (`nlToSqlAmbiguityNotes` in `packages/core/src/sql/schema-question-precheck.ts`). When the question seemed to name a table the schema doesn't have (`from X`, `join X`), the hint listed every table in `schema.tables`: `Known tables: hidden_payroll, orders.`

That list named tables the prompt's DDL leaves out. A table marked `tracked: false` is excluded from the DDL and from retrieval (`docs/contracts/schema-v2.md`), and under retrieval the DDL holds only the retrieved tables, yet both kinds were listed. Their names reached the model provider. The trigger was common: "from last month" reads as a table named `last`. The single-table note also named its table, counting untracked ones.

## Options considered

- **List only the tables the prompt shows.** Tracked tables, and under retrieval only the retrieved ones. Rejected: the hint would need the retrieved table set on every call and must follow any later change to what the DDL holds, so each new way of narrowing the prompt is a new way to leak a name. The list would also only repeat the DDL above it.
- **Name no schema table (chosen).** Drop the `Known tables:` list and the single-table note's table name. The DDL already lists every table the model may use, so the hint loses nothing the model needs.

## Decision

The hints name no table from the schema. The note for an unknown name repeats only the word from the question: `The question mentions table "X" which is not in the schema.` The single-table note says `The schema lists only one table.` without naming it. Both count tracked tables only, so a question that names an untracked table gets the note, as for any name the prompt doesn't list.

## Consequences

- An untracked table's name, and a table retrieval left out, can't reach the model through the hints.
- `nlToSqlAmbiguityNotes()` is exported, and its output is shorter (`@askdb/core` minor, upgrade guide `1.0.0-beta.50`).
- Under retrieval, the unknown-name check still uses every tracked table, so a tracked table retrieval left out gets no note. That names nothing, and the model reads only the DDL.
- The prompt's tenant-policy block is a separate path that still names policy tables the DDL leaves out (#771).

## Related

- `docs/contracts/schema-v2.md`: `tracked: false` excludes a table from prompt DDL and RAG indexing.
- ADR 0026: every prompt follows `ask()`'s sensitive-omission rule.
- #771: the tenant-policy block and untracked or unretrieved tables.
