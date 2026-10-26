---
"@askdb/core": patch
"@askdb/enrich": patch
"@askdb/rag": patch
"@askdb/studio": patch
---

**One rule for "mentions a sensitive column by name".** `@askdb/core` exports `findMentionedNames(text, names)`: a whole-word, case-insensitive match whose ends may not touch a letter, digit, or `_` of any script. `@askdb/rag`'s chunker and `@askdb/enrich`'s `findSensitiveColumnReferences` (Studio's authoring warning) both use it, so they agree on names like `ssn$` or `café`; before, enrich's `\b` boundaries missed `ssn$` and matched `caf` inside `café`. Studio keeps the details of a memory-store index in memory instead of `schema.lock.json`, which the indexer no longer writes for an ephemeral store.
