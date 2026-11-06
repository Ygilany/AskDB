---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The NL→SQL prompt's hints name no table from the schema (#677). When the question named a table the schema doesn't have (`from X`, `join X`), the note listed every table in `schema.tables`, including tables marked `tracked: false` and, under retrieval, tables retrieval left out, so their names reached the model provider. `nlToSqlAmbiguityNotes()` now returns `The question mentions table "X" which is not in the schema.` without the `Known tables:` list, and the single-table note no longer names the table. Both check the question against tracked tables only, the ones the prompt's DDL can show.

**Upgrade notes:** code that calls `nlToSqlAmbiguityNotes()` and reads its output gets the shorter notes. A question that names an untracked table now gets the "not in the schema" note.

The docs update the privacy model's list of what reaches the model, and the upgrade guide.
