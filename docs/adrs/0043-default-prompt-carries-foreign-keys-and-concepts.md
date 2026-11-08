# ADR 0043 — The default prompt carries foreign keys, concepts, business context and column notes

## Status

Accepted (2026-11-08). The maintainer asked for business context and relationships in a default `ask()` prompt for rc.1, and the coordinator scoped #898 on 2026-11-08 (column notes and concepts in, no opt-out option). Foreign keys and concepts shipped in PR #899. The maintainer then approved new optional fields, `NormalizedV2Table.businessContext` and `NormalizedV2Column.note` (#898, Q60), for business context and column notes, in the PR that closes #898.

## Context

A default `ask()` call (no retriever) sends the schema block `formatSchemaV2ForNlToSql` builds. It listed tables, columns, descriptions, aliases, enum values, common query language and sensitive tags. The schema artifact holds more: foreign keys (`relationships` in `schema.json`) never reached either prompt unless the index was built with `emitRelationships: true`, and concepts, business context and column notes reached it only through retrieval (#896). So without RAG the model guessed joins from column names, and never saw the business vocabulary in `concepts.md` or a table's `## Business context`. Foreign keys and concepts are already in `loadSchema()`'s result; the loader dropped business context and column notes, so they needed new fields.

## Options considered

- **A. Print them in both prompts, with the omission gate (chosen).** Each foreign key prints once, under the table that owns its column, as `FK (user_id) -> public.users (id)`, the format #349's step 5 planned. Concepts follow the tables in a `-- concepts --` block in the full-schema prompt. The retrieval prompt prints a foreign key only between tables it shows, and keeps listing only retrieved concepts, in the same shape.
- **B. Add them behind an option.** Rejected by the coordinator: an option added later is easy, one removed after the rc.1 freeze isn't (ADR 0030).
- **C. Keep them retrieval-only.** Rejected: the model then needs RAG to learn how tables join, which is the core of most multi-table questions.
- **D. A budget or truncation rule for the bigger prompt.** Rejected: cutting the schema to fit drops grounding by table order, and a partial schema gives confidently wrong SQL. Retrieval stays the answer for a big schema, and the RAG guide's rule of thumb moves from about 30 tables to about 22.
- **E. Business context and column notes without new fields.** The formatter takes the loaded schema, which dropped both. It could read them from the table markdown through a new `ask()` or formatter input, or through a channel hidden from the types. A new input is public surface too, on every call site; a hidden channel is lost when a host copies, builds or bundles the schema itself. New optional fields keep the rule that the schema renders and chunks only pick, and work for any schema a host passes. The maintainer chose the fields (#898, Q60) on the coordinator's recommendation.

## Decision

`formatSchemaV2ForNlToSql` prints each table's foreign keys after its column lines, and the schema's concepts after the tables. `synthesizeRetrievedDdl` prints a shown table's foreign keys to the other shown tables, and a retrieved concept the schema has in the same shape as the full-schema prompt. One renderer in `packages/core/src/schema/v2/format.ts` serves both (`foreignKeyLinesByTable`, `conceptRenderer`). A retrieved relationship chunk (`emitRelationships`) only picks its two tables, so the key prints once, from the schema; a retrieved concept the schema doesn't have keeps its chunk text.

- **Foreign keys:** names are written the way the prompt lists them (`unqualifiedNamespace`, `quoteIdentifier`). A key is left out when either column doesn't resolve or either table is untracked, and, with sensitive identifiers omitted, when either column or table is sensitive, so a key never names a column the prompt withholds. With sensitive names listed tagged, it prints, since the names are listed already. A composite key prints one line per column pair until the artifact groups them (#349).
- **Business context:** a `-- business context --` block under the table, after common query language (`businessContextLines`), under common query language's rules: the loader drops it for a sensitive table, and with omission on it's withheld when it names a sensitive column. The retrieval prompt keeps showing only retrieved business-context chunks (ADR 0042).
- **Column notes:** a column's note joins its annotation as one gated unit in both prompts (`columnAnnotation`); the loader drops it for a sensitive column (ADR 0042, amended).
- **Concepts:** each line holds the label, synonyms, links (named as the prompt names tables and columns) and description. A link to an untracked table, or to a column of one, is dropped, and so is a concept whose links are all untracked. A link to a table or column the schema doesn't have is dropped too. With omission on, a concept is withheld when its rendered text names a sensitive column or it links a sensitive table or column (ADR 0022); each withheld concept counts in `mentionDroppedCount`.

## Consequences

- Every default `ask()` prompt grows with what the schema holds: about 18 tokens per foreign key, 20 per note, 37 per concept and 90 per three-sentence business context (measured for #898), about a third more on a fully authored schema.
- Hosts send their business context, column notes, foreign keys and concepts to the language model provider without a retriever. The privacy model and the beta.53 upgrade notes say so.
- `NormalizedV2Table.businessContext` and `NormalizedV2Column.note` are public `@askdb/core` fields, frozen with the rest of its API at rc.1 (ADR 0030).
- Studio's tenant-policy draft uses the formatter's foreign-key lines (ADR 0021, amended). Core's enrichment prompt passes a physical copy without relationships or concepts, so it's unchanged (ADR 0026).
