---
"@askdb/core": patch
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-TENANT-NAMES](https://github.com/Ygilany/AskDB/security/advisories/GHSA-TENANT-NAMES)). The tenant check read some names, comments and joins differently from the engine, so a tenant-scoped query could pass while the engine read it without its tenant filter. The check now reads them the way each engine does:

- **`]]` and nested comments.** On SQL Server, `]]` inside a bracketed name is an escaped `]`, so `[o]] WHERE … AND [x]` is one name. On SQL Server, PostgreSQL and CockroachDB, block comments nest, so the check reads them both nested and not, and a predicate counts only when both readings see it. A predicate inside such a name or comment no longer counts.
- **Names outside printable ASCII.** SQL Server resolves a name through the database collation, which ignores some characters (U+200D, U+FEFF, any emoji) and reads others as ASCII letters (fullwidth letters, small capitals), so `[ｏｒｄｅｒｓ]` reads `orders`. Under `sqlserver`, a dialect id that is no built-in engine, or none, the tenant check refuses a name, quoted or not, that holds a character outside printable ASCII as `UNICODE_ESCAPED_IDENTIFIER`, and the sensitive check reports it as unresolved scope, unless the schema spells it exactly. This covers aliases and CTE names too.
- **Column lists after an alias.** PostgreSQL and CockroachDB read `orders t (agency_id, x)` as new names for the table's first columns, so `t.agency_id` filtered another column. Wherever the SQL may be read as Postgres, such a read is refused as `MISSING_TENANT_PREDICATE`.
- **Outer joins with a hint.** A join with `LEFT`, `RIGHT`, `FULL` or `OUTER` among its words is outer, whatever hint stands beside it, so CockroachDB's `LEFT STRAIGHT JOIN`, `LEFT LOOKUP JOIN` and `LEFT INVERTED JOIN` no longer count their `ON` as a filter. Neither does an `ON` that closes an earlier join (`a LEFT JOIN b JOIN c ON … ON …`).
- **Quoted tenant columns.** PostgreSQL and CockroachDB compare a quoted name exactly, so `"AGENCY_ID"` can be another source's column. Wherever the SQL may be read as Postgres, a quoted tenant column counts only when spelled as the schema spells it.
- **SQLite's single-quoted table names.** SQLite reads a `'…'` in a table's place as the table's name, so `SELECT * FROM 'orders'` read `orders` with no tenant predicate, and `SELECT * FROM 'users'` reached its sensitive columns. Under `sqlite`, a dialect id that is no built-in engine, or none, such a string right after `FROM`, `JOIN` or `IN`, after a `,` in a `FROM` list, or beside a `.` is now read as the table's name by the tenant and sensitive checks.
- **Quoted names spelled like a placeholder.** A quoted name such as `":tenant_agency_ids"`, `` `:tenant_agency_ids` `` or `[:tenant_agency_ids]` is a column to the engine and nothing binds it, but the check counted it as the placeholder. It no longer does. A U+0001 inside a quoted name no longer changes which later words the check reads as keywords.

Enforce tenant isolation in the database (for example row-level security) regardless.
