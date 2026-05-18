---
"@askdb/postgres": minor
"@askdb/introspect": patch
---

Remove the `["public"]` default schema filter in the Postgres connector so that introspection now covers all non-system schemas by default. Previously, databases with tables in custom schemas (e.g. `audit`, `reporting`, `db_changelog`) were silently omitted unless the caller explicitly passed `filters.schemas`. Explicit `schemas` and `excludeSchemas` filters continue to work as before.
