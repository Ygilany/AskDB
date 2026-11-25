---
"@askdb/core": patch
---

The sensitive-column check now reports sensitive columns read through Postgres `TABLE` shorthand in every position inside a `SELECT`: derived tables, CTE bodies, and set-operation branches, including `TABLE ONLY`, `ORDER BY`/`LIMIT` variants, parenthesised set-operation operands, a `TABLE` main query after `WITH`, and `IN (TABLE …)` subqueries. A `TABLE` command reads every column of its table, so a renamed column read through it is reported too, and a nested CTE named after a real table no longer hides that table from an outer reference. Previously those reads passed unreported; top-level `TABLE users` still fails closed as before.
