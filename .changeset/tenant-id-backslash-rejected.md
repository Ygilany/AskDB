---
"@askdb/core": patch
---

**A tenant ID containing a backslash is refused wherever AskDB inlines it**, on every dialect (#360, #371, ADR 0024). `ask()` and `resolveTenantSql()` in `tenantSqlMode: "sql-only"`, and `bindPreparedQuery()` (whose `sql` always inlines tenant IDs), throw `TenantScopeError` with reason `UNESCAPABLE_TENANT_ID` instead of returning SQL. Before, the ID was escaped for the dialect, or only had its quotes doubled for a custom `AskDialect`. On a server whose string settings differ from the dialect's, such an ID could end its literal early: on Postgres with `standard_conforming_strings = off`, the ID `x\' OR 1=1 --` made a scoped query return every row. Inlined tenant IDs without a backslash are unchanged. The default `"sql-params"` mode passes such IDs as driver parameters and is unaffected.
