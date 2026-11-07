# ADR 0038 — The NL→SQL prompt's hints name no schema table

## Status

Accepted (2026-11-06), for #677. The coordinator chose the option below in the #677 thread. Implemented in PR #804. Amended 2026-11-06 (#771): the tenant-policy block names only the tables the prompt shows (see Amendments).

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
- The prompt's tenant-policy block was a separate path that named policy tables the DDL leaves out; the #771 amendment below closes it.

## Related

- `docs/contracts/schema-v2.md`: `tracked: false` excludes a table from prompt DDL and RAG indexing.
- ADR 0026: every prompt follows `ask()`'s sensitive-omission rule.
- #771: the tenant-policy block and untracked or unretrieved tables.

## Amendments

**2026-11-06 — The tenant-policy block names only the tables the prompt shows (#771):** `buildTenantPromptBlock` listed every root, scoped, polymorphic and global table in the policy, and every column holding a root's IDs, including tables marked `tracked: false` and, under retrieval, tables retrieval left out. `ask()` now passes the tables the prompt shows: the tracked ones, and under retrieval only the retrieved ones. The block leaves the others out. The coordinator settled two cases where leaving a table out would drop something the model needs:

- **A root whose table isn't shown keeps its label and placeholder (1A).** A tracked table's predicate compares its column with the root's placeholder (`orders.agency_id = :tenant_agency_ids`), so the model needs it. The root's table id and its own columns leave the block, except a root column that a kept join path reaches (below). The label is text the policy's author wrote for prompt assembly, and the placeholder is derived from it (`placeholderForTenantRoot`), so both reach the model by design. Rejected: dropping the root entirely, which would leave every tracked table scoped to it impossible to filter, so the tenant check would refuse every query on them.
- **A join path through an untracked table is dropped; one through a tracked table retrieval left out stays (2A).** The author excluded an untracked table from prompts, so the scoped table loses that path, and the block tells the model not to read the table if no path is left. The tenant check still requires that table's predicate, so a query that reads it without one is refused. A tracked table that retrieval didn't pick is one the model may use, and dropping its path would drop the only predicate the model has for a retrieved table. So the path is printed with that table's name and columns, and the root column it reaches stays under the root's placeholder, since the path's predicate compares with it. Rejected: dropping the path in both cases, which refuses queries on retrieved tables when nothing untracked is involved.

Two more rules came out of the #814 review. Each column's table is looked up in the schema, not found by splitting the column id, since a table name can hold `#` (SQL Server): `table:dbo.Orders#Archive#AgencyId` belongs to `Orders#Archive`, not `Orders`. And a table the policy names as a root without declaring it (a `warn` policy's mapping or scope path) is named only when the prompt shows it; otherwise the block says "an undeclared root".

ADR 0026's exception still holds for the tables the block does show: under omission it names their sensitive tenant columns, because the model needs them to filter. Under retrieval, a retrieved `tenant-policy` chunk is the policy file's prose as its author wrote it, and reaches the model as written.

`buildTenantPromptBlock` takes the prompt's schema and, under retrieval, the retrieved table ids through a new argument, and works out the tracked and shown tables itself. The maintainer made it required (Q24 A), so a direct caller can't name a table the prompt leaves out by default. `buildNlToSqlUserPrompt` already takes the schema, so its block can't name an untracked table; the retrieved ids it gains stay optional, since leaving them out under retrieval names only tracked tables. A tenant policy with a v1 schema throws there, since it has no tracked tables to follow. `prebuiltDdl` and the ids stay two fields, which keeps the exported `AskDialectGenerateOptions` type as it was.
