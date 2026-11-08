---
"@askdb/core": minor
---

The default prompt carries business context and column notes (#898). `loadSchema()` returns a table's `## Business context` section as `NormalizedV2Table.businessContext` and a column's `## Column notes` item as `NormalizedV2Column.note`, both new optional fields, and drops both for a sensitive table or column, as it drops a description. `formatSchemaV2ForNlToSql` lists a table's business context under it, after its common query language, as a `-- business context --` block, and adds a column's note to its annotation (`note: …`). With `omitSensitiveIdentifiersFromPrompt`, a business context that names a sensitive column is withheld, and a note is withheld with the rest of its column's annotation when either names one.

`synthesizeRetrievedDdl` now reads every shown column's note from the schema, as the full-schema prompt does, instead of a retrieved column chunk's `Note: ` line (ADR 0042, amended). Its business context still comes from retrieved chunks.

Upgrade notes: every host now sends its business context and column notes to the language model provider without a retriever, and tests that compare `loadSchema()`'s result see the new fields. The beta.53 section of the upgrade guide says what to check.
