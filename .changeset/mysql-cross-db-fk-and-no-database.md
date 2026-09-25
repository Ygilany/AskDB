---
"@askdb/mysql": patch
"@askdb/introspect": patch
---

**@askdb/mysql**: fix two introspection correctness bugs.

- **Cross-database foreign keys** were rendered as if the referenced table were local (`REFERENCES billing.users` became a relationship to the introspected database's `users`). The connector only introspects the connection's database, so these FKs are now omitted and reported as a `cross_database_fk` warning naming the referenced database and table.
- **No database in the connection URL** (`mysql://user:pass@host:3306`) made `DATABASE()` NULL, so every catalog query silently matched nothing and introspection produced an empty schema. It now throws a clear `AskDbError` asking for the database name in the URL path.

**@askdb/introspect**: add the `cross_database_fk` variant to `IntrospectionWarning` (`{ code, table, constraint, referencedDatabase, referencedTable }`).
