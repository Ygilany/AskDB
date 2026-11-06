---
"@askdb/docs-site": patch
---

The "Row limits" section of [Run safely in production](https://askdb.tools/guides/run-safely-in-prod/#row-limits) now caps rows in a way that works on every engine and keeps the query's `ORDER BY`. The old recipe wrapped the SQL in `SELECT * FROM (…) AS askdb_q LIMIT 1000`. SQL Server rejects that wrapper, MariaDB returns the rows in another order, and MySQL and MariaDB reject it when two columns have the same name. Each engine now has its own tab: a cursor on Postgres, a stream that stops one row past the cap on MySQL, MariaDB and SQLite, and `SET ROWCOUNT` in the same parameterized query on SQL Server. The wrapper stays as an option for Postgres and SQLite only. "Safety boundaries", "How AskDB works" and the beta.44 upgrade note link to the new section.
