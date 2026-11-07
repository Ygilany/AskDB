---
"@askdb/core": patch
---

The tenant check requires a table's predicate wherever the query names the table, quoted or not, except in `ORDER BY` and `GROUP BY`. It skipped an unquoted name on its own list of keywords, but some engines take several of them as plain table names (`user` on MySQL; `lock`, `qualify` and `by` on Postgres), so a query reading such a table unfiltered passed.
