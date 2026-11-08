---
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-9w7p-c3w8-4839](https://github.com/Ygilany/AskDB/security/advisories/GHSA-9w7p-c3w8-4839)). The tenant check read some table names, `HAVING` clauses and conditions differently from the engine, so a tenant-scoped query could pass while the engine read it without its tenant filter. The check now reads them the way each engine does:

- **SQLite string names in parentheses.** SQLite reads `FROM ('orders')` as the table `orders`, and `(orders) 'o'` as that read aliased `o`. Under `sqlite`, a dialect id that is no built-in engine, or none, the tenant check reads them that way.
- **`HAVING` on an ungrouped column.** A tenant predicate in `HAVING` counts only when its column is a key of the `SELECT`'s `GROUP BY`. Read the MySQL way, an unqualified column that a select-list item is aliased to doesn't count there.
- **`BETWEEN`.** The `AND` that closes a `BETWEEN` is no conjunction, so a predicate written as its upper bound doesn't count.
- **`order` or `group` after a spaced dot.** `billing . order` is the table `billing.order`, with any whitespace or comment around the dot.
- **An `OR` after an alias spelled like a clause word.** An `OR` later in the clause counts as beside the predicate after a word some engine takes as a name (`lock`, `qualify`, `limit`, `natural`, `using`, `window`).

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: a tenant predicate in `HAVING` on a column the `SELECT` doesn't group by, or, read the MySQL way, on a name a select-list item is aliased to (put it in `WHERE`); a predicate written as a `BETWEEN`'s upper bound (make it its own conjunct); and, under `sqlite`, a custom id or none, an unfiltered read written `FROM ('orders')` (filter it, or write `FROM orders`).
