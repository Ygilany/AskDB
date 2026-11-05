---
"@askdb/client": patch
---

`askdb.bind()` takes `tenantSqlMode`, which it passes to `bindPreparedQuery()`. By default the rebound `sql` holds tenant markers and the IDs are in `tenantParams`, as in `askdb.ask()` (#664).
