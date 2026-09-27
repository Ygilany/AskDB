---
"@askdb/mysql": minor
"@askdb/config": minor
"askdb": minor
"@askdb/studio": patch
---

**MySQL/MariaDB: introspect several databases at once.**

**@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

**@askdb/config**: New `introspection.schemas?: string[]`, the config equivalent of `askdb introspect --schemas`, for every provider (on MySQL/MariaDB, the databases to introspect). Runtime config exposes it as `introspection.schemas`.

**askdb**: `askdb introspect` reads `introspection.schemas` from config for any engine; `--schemas` overrides it.

**@askdb/studio**: Resync passes the configured schema list to the connector, so it matches `askdb introspect`.
