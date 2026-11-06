---
"@askdb/core": minor
---

`tenantSqlMode` governs `sql` only (#731). Under `"sql-only"`, `ask()` now binds the tenant IDs in `unboundSql`, with their values in `params`, as `bindPreparedQuery()` already did. Before, `ask()` inlined them into `unboundSql` and left them out of `params`, so one mode had two contracts. `sql` is unchanged. A host that runs `unboundSql` with `params` needs no change. One that runs `unboundSql` with its own array of business values must switch to `params` before upgrading: the values no longer line up with the markers. The drivers AskDB documents (`pg`, `mysql2`, `mssql`, `better-sqlite3`) refuse the short array, but `node:sqlite` doesn't check the number of values it binds and runs the query, which can return another tenant's rows. Always pass `params` as returned. See the upgrade guide.
