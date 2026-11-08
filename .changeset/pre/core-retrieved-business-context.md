---
"@askdb/core": minor
---

The retrieval prompt shows the text of retrieved `Business context` and `Column notes` chunks (#894). `synthesizeRetrievedDdl` lists a retrieved business context under its table, after its common query language, as a `-- business context --` block with the parts of a long body in order. It keeps a retrieved concept's label and a tenant-policy section's name. (A column's `Column notes` item reaches both prompts from the schema since #898; see that changeset.) Before, a business-context or column chunk only picked its table, and its text never reached the model, though the schema v2 contract said it would.

The gates for common query language apply: a sensitive table's business context and a sensitive column's note are never shown, and with `omitSensitiveIdentifiersFromPrompt` a text that names a sensitive column, or a chunk flagged `sensitive`, is withheld. A note is checked with its column's annotation as one unit, so the two are withheld together (ADR 0042). Existing indexes work unchanged: core recognizes a business-context chunk by its `#biz` id. No exported type changes.

Upgrade notes: with a retriever, your language model provider now receives this text, not only your embedding provider. The beta.53 section of the upgrade guide says what to check.
