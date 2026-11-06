---
"@askdb/core": minor
---

**Breaking: enrichment targets take loaded tables** (#667, ADR 0026). `EnrichmentTarget.table` and `EnrichmentContext.neighbors` are now `NormalizedV2Table`, the table type in `loadSchema()`'s result, instead of `V2Table`, the table as `schema.json` stores it. Before, a host could pass `suggestEnrichment()` or `buildEnrichmentUserPrompt()` a table read straight from `schema.json`, which lacks front-matter sensitivity: with `omitSensitiveIdentifiersFromPrompt` on, a column marked sensitive only in `tables/*.md` was named in the prompt, and a suggestion for it wasn't refused. The compiler now refuses such a table. Runtime behavior is unchanged.

**What a host must change:** build the target and context from `loadSchema()`'s result, with `@askdb/enrich`'s `buildSuggestionTarget(schema, source)` and `buildSuggestionContext(schema, tableId)` or from `schema.tables`. A table you build by hand must set `sensitive` on the table, and `sensitive` and `primaryKey` on every column; mark sensitive each column that `tables/*.md` marks, and every column of a sensitive table, as `loadSchema()` does. Studio and hosts that already use the `@askdb/enrich` builders need no change.
