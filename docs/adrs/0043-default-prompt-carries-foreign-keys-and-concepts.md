# ADR 0043 — The default prompt carries foreign keys and concepts

## Status

Accepted (2026-11-08) for foreign keys and concepts: the maintainer asked for business context and relationships in a default `ask()` prompt for rc.1, and the coordinator scoped #898 on 2026-11-08 (column notes and concepts in, no opt-out option). Business context and column notes wait on the maintainer's decision on new optional `NormalizedV2Table` and `NormalizedV2Column` fields (#898, decision 1), and will amend this record. Implemented in the PR that closes the foreign-key and concepts part of #898.

## Context

A default `ask()` call (no retriever) sends the schema block `formatSchemaV2ForNlToSql` builds. It listed tables, columns, descriptions, aliases, enum values, common query language and sensitive tags. The schema artifact holds more: foreign keys (`relationships` in `schema.json`) never reached either prompt unless the index was built with `emitRelationships: true`, and concepts reached it only through retrieval. So without RAG the model guessed joins from column names, and never saw the business vocabulary in `concepts.md`. Both are already in `loadSchema()`'s result, so they need no type change.

## Options considered

- **A. Print them in both prompts, with the omission gate (chosen).** Each foreign key prints once, under the table that owns its column, as `FK (user_id) -> public.users (id)`, the format #349's step 5 planned. Concepts follow the tables in a `-- concepts --` block in the full-schema prompt. The retrieval prompt prints a foreign key only between tables it shows, and keeps listing only retrieved concepts, in the same shape.
- **B. Add them behind an option.** Rejected by the coordinator: an option added later is easy, one removed after the rc.1 freeze isn't (ADR 0030).
- **C. Keep them retrieval-only.** Rejected: the model then needs RAG to learn how tables join, which is the core of most multi-table questions.
- **D. A budget or truncation rule for the bigger prompt.** Rejected: cutting the schema to fit drops grounding by table order, and a partial schema gives confidently wrong SQL. Retrieval stays the answer for a big schema, and the RAG guide's rule of thumb moves from about 30 tables to about 22.

## Decision

`formatSchemaV2ForNlToSql` prints each table's foreign keys after its column lines, and the schema's concepts after the tables. `synthesizeRetrievedDdl` prints a shown table's foreign keys to the other shown tables, and a retrieved concept the schema has in the same shape as the full-schema prompt. One renderer in `packages/core/src/schema/v2/format.ts` serves both (`foreignKeyLinesByTable`, `conceptRenderer`). A retrieved relationship chunk (`emitRelationships`) only picks its two tables, so the key prints once, from the schema; a retrieved concept the schema doesn't have keeps its chunk text.

- **Foreign keys:** names are written the way the prompt lists them (`unqualifiedNamespace`, `quoteIdentifier`). A key is left out when either column doesn't resolve or either table is untracked, and, with sensitive identifiers omitted, when either column or table is sensitive, so a key never names a column the prompt withholds. With sensitive names listed tagged, it prints, since the names are listed already. A composite key prints one line per column pair until the artifact groups them (#349).
- **Concepts:** each line holds the label, synonyms, links (named as the prompt names tables and columns) and description. A link to an untracked table, or to a column of one, is dropped, and so is a concept whose links are all untracked. A link to a table or column the schema doesn't have is dropped too. With omission on, a concept is withheld when its rendered text names a sensitive column or it links a sensitive table or column (ADR 0022); each withheld concept counts in `mentionDroppedCount`.

## Consequences

- Every default `ask()` prompt with foreign keys or concepts grows: about 18 tokens per foreign key and 37 per concept (measured for #898).
- Hosts send their foreign keys and concepts to the language model provider without a retriever. The privacy model and the beta.53 upgrade notes say so.
- Studio's tenant-policy draft uses the formatter's foreign-key lines (ADR 0021, amended). Core's enrichment prompt passes a physical copy without relationships or concepts, so it's unchanged (ADR 0026).
- When the maintainer approves the new fields, business context and column notes join this renderer: `businessContextLines` and `columnAnnotation`'s note already serve the retrieval prompt (ADR 0042).
