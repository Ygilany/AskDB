---
"@askdb/core": minor
---

The default prompt lists foreign keys and concepts (#898). `formatSchemaV2ForNlToSql` prints each table's foreign keys after its column lines, as `FK (user_id) -> public.users (id)`, with names written the way the prompt lists them, and the schema's concepts after the tables, each with its label, synonyms, links and description. `synthesizeRetrievedDdl` prints a shown table's foreign keys to the other shown tables, and still lists only retrieved concepts. Before, foreign keys reached the model only through retrieval with `emitRelationships: true`, and concepts only through retrieval.

A foreign key or concept never names an untracked table. With `omitSensitiveIdentifiersFromPrompt`, a foreign key with a sensitive column or table on either side is left out, and a concept that names or links one is withheld and counted in `mentionDroppedCount`. A composite key prints one line per column pair. No exported type or option changes (ADR 0043).

Upgrade notes: every host now sends its foreign keys and concepts to the language model provider without a retriever, and the prompt grows. The beta.53 section of the upgrade guide says what to check.
