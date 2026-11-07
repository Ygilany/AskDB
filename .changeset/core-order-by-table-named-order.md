---
"@askdb/core": patch
---

The tenant check no longer reads the words of `ORDER BY` or `GROUP BY` as a reference to a table named `order` or `group`. Under a policy with such a table, it refused every sorted query. A quoted or qualified name (`"order"`, `billing.order`), in `FROM`, `JOIN` or a qualifier, still counts as the table (#828).
