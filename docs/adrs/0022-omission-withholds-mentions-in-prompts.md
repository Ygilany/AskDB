# ADR 0022 — With omission on, NL→SQL prompts withhold text that names a sensitive column, and re-check retrieved chunks

## Status

Accepted (2026-11-05, maintainer decision on #374's plan). The rule is `promptTextGate` in `packages/core/src/schema/v2/format.ts`, used by `formatSchemaV2ForNlToSql` and `synthesizeRetrievedDdl` (`packages/core/src/retrieval/synthesize-ddl.ts`). The names it checks come from `sensitiveMentionNames` (`packages/core/src/schema/v2/mentions.ts`), the list ADR 0017 defines, which `@askdb/rag`'s chunker now imports instead of keeping its own copy. Contract: [`schema-v2.md` → Sensitive propagation](../contracts/schema-v2.md#sensitive-propagation).

## Context

`omitSensitiveIdentifiersFromNlToSqlPrompt: true` withheld a sensitive column's own line from the NL→SQL prompt and stubbed a sensitive table. It kept every other piece of text that named the column: a non-sensitive table's description and aliases, a non-sensitive column's aliases, enum values and description, and the common query language block. A `customers` description of "Stores each customer's email and phone" reached the model with `email` and `phone` withheld.

`@askdb/rag` already left that text out of the index (ADR 0017), but neither prompt builder asked the question:

- **The whole-schema prompt** (`formatSchemaV2ForNlToSql`) renders from the normalized schema and never looked inside the text.
- **The retrieval prompt** (`synthesizeRetrievedDdl`) uses a retrieved chunk to pick its table, then renders that table's description, aliases and enum values from the schema again, so the index's filter had no effect on them. It renders common query language, concept, example question, relationship and tenant policy chunks from the chunk text, and checked neither that text nor the chunk's `sensitive` flag.

A chunk that names a sensitive column reaches `synthesizeRetrievedDdl` whenever the index wasn't built by today's default `@askdb/rag`: an index built with `includeSensitiveDescribable: true` keeps it flagged `sensitive: true`, an index built before ADR 0017 (beta.44) checked a table's text only against that table's own sensitive columns, and a custom `Retriever` makes no promise at all.

## Decision

- With omission on, both prompt builders check every piece of describable text they render against `sensitiveMentionNames(schema)`, with the contract's mention rule, and withhold the text that names a sensitive column. With omission off, the prompt lists sensitive names tagged `(sensitive)` on purpose, so nothing changes.
- The units match `@askdb/rag`'s chunker: a table's description and each of its aliases on their own; a column's aliases, enum values and description as one annotation, withheld together; the whole common query language block. Text is never cut out of the middle of a sentence.
- On the retrieval path, core trusts nothing the retriever did. With omission on, it withholds a chunk's text when the text, checked exactly as the prompt renders it (lines joined), names a sensitive column **or** the chunk is flagged `sensitive: true`. The flag catches what the text can't show: a concept flagged for linking to `table:public.users#org_id`, a link id the mention rule doesn't read as `users.org_id`.
- A withheld chunk still picks its tables, so the model sees the same table definitions with or without omission, and only the text changes.
- `NlToSqlSchemaFormatStats.mentionDroppedCount` and `synthesizeRetrievedDdl`'s `mentionDroppedCount` count what was withheld. `askdb.prompt.sensitive_redacted` carries the whole schema's count, as its column counts already do on the retrieval path; `askdb.pipeline.retrieval_used` carries the retrieval prompt's own.

## Options considered

- **Check the text only.** Rejected: it misses a chunk flagged for its links, such as a concept that links to a column sensitive only through its table.
- **Trust the flag only.** Rejected: a custom retriever and an index built before ADR 0017 send mentioning chunks with `sensitive: false`.
- **Partial redaction** (replace the name with a placeholder and keep the sentence). Rejected, as it was for the chunker: the rest of the sentence still says what the column holds, and a placeholder tells the model a name was removed.
- **Keep the name list in `@askdb/rag` and copy it into core.** Rejected: two owners of ADR 0017's rule would drift, which is how the two prompt paths came to disagree with the index.
- **Export a matcher (`createSensitiveMentionMatcher(schema)`) instead of the list.** Rejected: the list composes with both `createMentionMatcher` and `findMentionedNames`, and an authoring warning (#453) needs to name which column it found.

## Consequences

- With omission on, the model sees less describable text for schemas whose prose names sensitive columns. ADR 0017's over-exclusion applies: a column marked sensitive itself with a generic name (a PII `name`) withholds every text that uses the word.
- A column whose description names a sensitive column also loses its enum values and aliases in the prompt, since the annotation is one unit.
- Hosts that read `NlToSqlSchemaFormatStats` get a new required field; a host that builds one by hand must set it.
- The check runs on every `ask()` with omission on, over the whole schema even when a retriever supplies the DDL (for the redaction event's count). `createMentionMatcher` groups qualified names by table so that this stays cheap on large schemas with whole sensitive tables.
- The tenant policy block (structured front-matter, always in the prompt) still names tenant columns under omission. Whether it should is #624.
