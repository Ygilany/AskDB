---
"@askdb/core": patch
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-wjgj-mf9h-6g68](https://github.com/Ygilany/AskDB/security/advisories/GHSA-wjgj-mf9h-6g68)). With `tenantSqlMode: "sql-only"` on the built-in `postgres` or `cockroachdb` dialect, `ask()` could return SQL whose tenant scoping no longer held once the tenant IDs were inlined, because it did not re-check the rendered statement. `ask()` now runs the read-only check on the `sql` it returns, as `bindPreparedQuery()` already does, and refuses a statement that reads differently once rendered. The default `tenantSqlMode: "sql-params"`, which binds tenant IDs as driver parameters, was never affected.
