---
"@askdb/core": patch
---

The sensitive-column check now reports sensitive columns read through Postgres `TABLE` shorthand in derived tables, CTE bodies, and set-operation branches (`SELECT * FROM (TABLE users) t`, `WITH c AS (TABLE users) SELECT * FROM c`, `SELECT id FROM orders UNION TABLE users`). Previously those reads passed unreported; top-level `TABLE users` still fails closed as before.
