---
"@askdb/core": minor
---

The read-only check refuses SQL that advances a sequence (#825). On the `mysql` and `mariadb` dialects, `NEXTVAL(…)` and `SETVAL(…)` are blocked functions now (`SQL_FORBIDDEN_FUNCTION`), as `nextval` and `setval` already were on Postgres and CockroachDB: MariaDB advances or sets the sequence from a `SELECT`, and the change isn't rolled back with the transaction. On every dialect, the unquoted words `NEXT VALUE FOR` fail with the same rule code, since MariaDB and SQL Server advance the sequence too, and Postgres and SQLite don't parse them. `PREVIOUS VALUE FOR`, MariaDB's `LASTVAL()` and a column named `nextval` or `setval` still pass. `ask()`, `bindPreparedQuery()` and Studio's Execute refuse the same SQL.
