---
"@askdb/docs-site": patch
---

The docs say `tenantSqlMode` defaults to `"sql-params"`, and that hosts run `result.sql` with `result.tenantParams` (the core and client API references, the multi-tenancy, embed-in-node and run-safely-in-prod guides, and `/AGENTS.md`). The `TenantSqlOutputMode` reference no longer says `sql-params` uses Postgres `$N` markers on every dialect (#320). Safety boundaries and the core API reference say a tenant ID with a backslash is refused wherever it's inlined, on every dialect. Troubleshooting gains `UNESCAPABLE_TENANT_ID` and the driver error a host sees when it runs the new `sql` without its params.
