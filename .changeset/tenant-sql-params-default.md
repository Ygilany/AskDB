---
"@askdb/core": minor
"@askdb/client": patch
"@askdb/studio": patch
---

**Breaking: tenant IDs are driver parameters by default** (`tenantSqlMode: "sql-params"`, #231, ADR 0024).

**What a host must change:** if you pass `tenantScope` to `ask()` (or `askdb.ask()` in `@askdb/client`, which forwards to it) without `tenantSqlMode`, `result.sql` now holds the dialect's driver markers (`$1`, `?` or `@p0`) where the tenant IDs used to be inlined, and the IDs are in `result.tenantParams`. Run `result.sql` with `result.tenantParams`, or `result.unboundSql` with `result.params` (which already holds the tenant IDs); never concatenate the two arrays. To keep the old output, set `tenantSqlMode: "sql-only"`. Running the new `sql` without its params fails at the driver (Postgres: "there is no parameter $1"; better-sqlite3: "Too few parameter values"; MySQL: a syntax error). It never returns other tenants' rows.

A custom `AskDialect` gets `$N` markers, because AskDB doesn't know its driver. If your driver uses `?` or `@p0`, set `tenantSqlMode: "sql-only"`.

`resolveTenantSql()` defaults to `"sql-params"` too. The default is exported as `DEFAULT_TENANT_SQL_MODE`; import it rather than hard-code the mode. Studio's Playground now starts in `sql-params`, and Studio reports that default when a request names no mode.
