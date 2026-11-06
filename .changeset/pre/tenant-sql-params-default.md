---
"@askdb/core": minor
"@askdb/client": patch
"@askdb/studio": patch
---

**Breaking: tenant IDs are driver parameters by default** (`tenantSqlMode: "sql-params"`, #231, ADR 0024).

**What a host must change:** if you pass `tenantScope` to `ask()` (or `askdb.ask()` in `@askdb/client`, which forwards to it) without `tenantSqlMode`, `result.sql` now holds the dialect's driver markers (`$1`, `?` or `@p0`) where the tenant IDs used to be inlined, and the IDs are in `result.tenantParams`. Run `result.sql` with `result.tenantParams`, or `result.unboundSql` with `result.params` (which already holds the tenant IDs); never concatenate the two arrays. To keep the old output, set `tenantSqlMode: "sql-only"`. Running the new `sql` without its params fails at the driver (Postgres: "there is no parameter $1"; better-sqlite3: "Too few parameter values"; MySQL: a syntax error). It never returns other tenants' rows.

**A custom `AskDialect`, or a `DialectSpec` whose `id` isn't built in, has no default.** With a tenant scope and no `tenantSqlMode`, `ask()` now throws `TenantScopeError` with the new reason `TENANT_SQL_MODE_REQUIRED`, before any retrieval or model call. AskDB can't know which parameter markers such a dialect's driver takes, and the `$N` markers it would emit are money constants on SQL Server, where `agency_id = $1` runs and matches agency 1. Set `tenantSqlMode: "sql-params"` if your driver binds `$1`-style markers, or `"sql-only"` to keep the IDs inlined. On any dialect, `ask()` with a tenant scope and `resolveTenantSql()` now throw the same reason for a `tenantSqlMode` that is neither of the two (for example `"sql_only"`) instead of treating it as `"sql-params"`.

`resolveTenantSql()` defaults to `"sql-params"` too. The default is exported as `DEFAULT_TENANT_SQL_MODE`; import it rather than hard-code the mode. Studio's Playground now starts in `sql-params`, and Studio reports that default when a request names no mode.
