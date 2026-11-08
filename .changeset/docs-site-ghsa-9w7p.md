---
"@askdb/docs-site": patch
---

The tenant-policy reference says a `HAVING` predicate counts only on a column the `SELECT` groups by, that a `BETWEEN`'s upper bound doesn't count, that SQLite reads a quoted table name in parentheses too, and that on Postgres and CockroachDB a tenant column or discriminator counts only when written as the engine reads the schema's spelling. The beta.53 upgrade notes cover the `HAVING` and column-name changes.
