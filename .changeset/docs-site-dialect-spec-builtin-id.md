---
"@askdb/docs-site": patch
---

The docs say `ask()` refuses a `DialectSpec` whose `id` isn't built in, with `UnknownDialectError` (#717): the core API reference (the `DialectSpec` section, `UnknownDialectError`, and the `tenantSqlMode` and `TENANT_SQL_MODE_REQUIRED` entries, which no longer mention such a spec), the multi-tenancy guide, troubleshooting, the client API reference, and a beta.48 upgrade entry.
