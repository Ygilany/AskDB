---
"@askdb/client": patch
---

`askdb.bind()` takes `tenantSqlMode`, which it passes to `bindPreparedQuery()`. By default the rebound `sql` holds tenant markers and the IDs are in `tenantParams`, as in `askdb.ask()` (#664). If you rebind with a `tenantScope` and run `rebound.sql`, pass `rebound.tenantParams` with it, run `rebound.unboundSql` with `rebound.params`, or set `tenantSqlMode: "sql-only"` to keep the IDs inlined.
