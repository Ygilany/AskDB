---
"@askdb/core": patch
---

The tenant check reads `$` the way each engine does. A `$` right after a name character continues the name (`x$$y` is one name on Postgres, CockroachDB, MySQL, MariaDB and SQLite), and `$tag$…$tag$` is a string only on Postgres and CockroachDB. Before, the check read either as the start of a string under every dialect, so it could miss a table the engine reads, and pass a query that reads other tenants' rows.
