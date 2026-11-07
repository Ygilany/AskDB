---
"@askdb/docs-site": patch
---

The SQL checks reference, the errors reference, troubleshooting and the beta.52 upgrade notes say that a `$N` parameter written against a word (`$1INTO`) is refused with `SQL_FORBIDDEN_KEYWORD` where the SQL may be read as Postgres (#665).
