---
"@askdb/core": patch
---

`suggestEnrichment()` can leave sensitive columns out of its prompt (#625, ADR 0026). `SuggestEnrichmentDeps` and `buildEnrichmentUserPrompt`'s new third argument take `omitSensitiveIdentifiersFromPrompt` (the new exported `EnrichmentPromptOptions` type); pass your `modes.omitSensitiveFromPrompt`, since core reads no config. The prompt now lists the target table with `formatSchemaV2ForNlToSql`, the formatter `ask()` uses (`TABLE public.users` with `- email text (NOT NULL) (sensitive)` lines in place of `Table:` and `email text [sensitive]`), over the table's physical fields only. With the option on, sensitive columns are withheld and a sensitive table keeps only its name. A target that is itself a sensitive column throws the new `SensitiveEnrichmentTargetError` (an `AskDbError` whose message names no column) before any model call. Unset, suggestions differ only in the line format.
