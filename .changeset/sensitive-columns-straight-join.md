---
"@askdb/core": patch
---

The sensitive-column check now treats MySQL/MariaDB `STRAIGHT_JOIN` as a join operator, so `SELECT * FROM orders STRAIGHT_JOIN users` reports `users.ssn` instead of passing silently — including when the joined table's alias is spelled like a SELECT modifier (`sql_cache`) — and a sensitive column named `straight_join` stays reported outside modifier position; `SELECT STRAIGHT_JOIN * FROM users` still reads as the SELECT modifier (closes #308).
