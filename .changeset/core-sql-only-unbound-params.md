---
"@askdb/core": minor
---

`tenantSqlMode` governs `sql` only (#731). Under `"sql-only"`, `ask()` now binds the tenant IDs in `unboundSql`, with their values in `params`, as `bindPreparedQuery()` already did. Before, `ask()` inlined them into `unboundSql` and left them out of `params`, so one mode had two contracts. `sql` is unchanged. A host that runs `unboundSql` with `params` needs no change; one that runs `unboundSql` with its own business values must use `params`. See the upgrade guide.
