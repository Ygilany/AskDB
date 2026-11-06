---
"@askdb/core": minor
---

`tenantSqlMode` governs `sql` only (#731). Under `"sql-only"`, `ask()` now binds the tenant IDs in `unboundSql`, with their values in `params`, as `bindPreparedQuery()` already did. Before, `ask()` inlined them into `unboundSql` and left them out of `params`, so one mode had two contracts. `sql` is unchanged. A host that runs `unboundSql` with `params` needs no change. One that runs `unboundSql` with its own array of business values must switch to `params` before upgrading: the values no longer line up with the markers, and a driver that binds a missing parameter as `NULL` (such as `node:sqlite`) runs the query anyway, which can return another tenant's rows. See the upgrade guide.
