---
"@askdb/core": minor
---

**Breaking: a rebind binds tenant IDs as driver parameters by default, as `ask()` does** (#664, ADR 0024). `BindGuardrails` takes `tenantSqlMode`, default `"sql-params"`: with a tenant scope, the `sql` that `bindPreparedQuery()` returns keeps the business values inlined and holds the tenant IDs as driver markers (`$1`, `?` or `@p0`, numbered from the first slot), and the new `BoundQuery.tenantParams` holds the IDs. So a tenant ID that no literal carries safely, such as `agência` or one with a backslash, now rebinds; before, the rebind threw `UNESCAPABLE_TENANT_ID` for it. `"sql-only"` inlines the IDs as before, and refuses such an ID. `unboundSql` + `params` don't change, and without a tenant policy `sql` doesn't change. A `tenantSqlMode` that is neither mode throws `TenantScopeError` (`TENANT_SQL_MODE_REQUIRED`).

**What a host must change:** with a tenant scope, run the rebound `sql` with `tenantParams` (`pool.query(rebound.sql, rebound.tenantParams ?? [])`), or run `unboundSql` with `params`. Running `sql` alone now fails at the driver; it never returns other tenants' rows. To keep inlined IDs, pass `tenantSqlMode: "sql-only"`.
