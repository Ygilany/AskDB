# ADR 0042 — The retrieval prompt reads business context and column notes from the chunks

## Status

Accepted (2026-11-07; amended 2026-11-08, #898). The coordinator chose option B on 2026-11-07 for #894, after the author's investigation. Implemented in PR #896.

> **Amendment (2026-11, #898):** `loadSchema()` now carries a column's `Column notes` item as `NormalizedV2Column.note` (the maintainer's decision on #898), so the retrieval prompt reads every shown column's note from the schema, inside `columnAnnotation`, as the full-schema prompt does. It no longer reads a column chunk's `Note: ` line, and a column chunk only picks its table again. The note stays one gated unit with the column's annotation; a flagged column chunk no longer matters to it, since the gate already withholds an annotation that names a sensitive column, and a sensitive column has no annotation. Business context under retrieval is unchanged: it still comes from retrieved `#biz` chunks, so that id stays part of the contract.

## Context

The schema v2 contract says a table's `## Business context` and `## Column notes` reach the model through retrieval. They didn't (#894). `@askdb/rag` builds a business-context chunk with `type: "table"`, and `synthesizeRetrievedDdl` used a `table` chunk only to pick its table: the TABLE block comes from the schema, which doesn't carry business context, so the chunk's text was dropped. A column chunk's `Note:` line was dropped the same way, since a `column` chunk also only picked its table.

## Options considered

- **A. A new `"business-context"` chunk type.** A new member of `@askdb/rag`'s `ChunkType` and `@askdb/core`'s `RetrievedChunkType`, and a new `ChunkStats.byType` key. It breaks host code with exhaustive switches or a `Record<ChunkType, …>`, and `filter.types: ["table"]` stops returning business context. It doesn't fix existing indexes: the indexer skips a chunk whose text and embedder are unchanged and doesn't write its payload again, so stored chunks keep `type: "table"` until a forced reindex, and core would need option B's id check anyway. It doesn't cover column notes.
- **B. Synthesis reads them from the chunks (chosen).** Core treats a `table` chunk whose id is `<its table ref>#biz`, or `…#biz#bc:<n>` for part n of a long body, as business context, and reads a column chunk's note from its `Note: ` line. No exported type changes, and existing indexes work as they are.
- **C. Change the contract instead.** Say the two sections only steer retrieval. No code change, but the promise that business terms reach the model goes.
- **D. Carry the text in the normalized schema.** New optional `NormalizedV2Table` and `NormalizedV2Column` fields from `loadSchema()`, rendered for picked tables. Additive public fields on a 1.0 package, and a change to `loadSchema()`'s output for every consumer, for no gain over B.

## Decision

`synthesizeRetrievedDdl` lists a retrieved business context under its table, after its common query language, as a `-- business context --` block, with a split body's parts in body order. It adds a retrieved column chunk's note to that column's annotation (`note: …`). A retrieved concept keeps its label, and a tenant-policy section its name.

Business context passes the same gates as common query language: never shown for a sensitive table, and with omission on, withheld when it names a sensitive column or its chunk is flagged `sensitive` (ADR 0022). A note joins its column's annotation as one gated unit, as it joins the column's describable layer in the chunker: never shown for a sensitive column, and with omission on, the annotation and note are withheld together when either names a sensitive column or the chunk is flagged.

## Consequences

- The `#biz` and `#biz#bc:<n>` chunk ids and the column chunk's `Note: ` line are part of the contract between `@askdb/rag` and `@askdb/core` (`docs/contracts/schema-v2.md`, chunking rules). Changing either in the chunker means changing synthesis in the same PR.
- Hosts with a retriever send more authored text to the language model provider, not only the embedding provider. The privacy model and the beta.53 upgrade notes say so.
- A custom retriever that returns `table` chunks with other ids is unaffected.
