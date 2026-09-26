---
"@askdb/mysql": minor
"@askdb/config": minor
"askdb": minor
"@askdb/studio": patch
---

**MySQL/MariaDB: introspect several databases at once.**

**@askdb/mysql**: The MySQL connector honors `filters.schemas` as a list of databases (MySQL's "schemas"). Each listed database becomes its own namespace in the artifact (`table:sales.orders`), and foreign keys that cross databases keep the referenced database. `filters.excludeSchemas` removes entries from the list. Before this change the connector read only the connection's database (`DATABASE()`) and silently ignored `filters.schemas`. Without a list, behavior is unchanged: the connection's database is read and rendered under the `public` namespace. The exported `MYSQL_CATALOG_SQL` strings now also select `table_schema` (and `referenced_table_schema` for foreign keys).

**@askdb/config**: New `introspection.providerConfig.mysql.databases?: string[]`.

**askdb**: `askdb introspect --engine mysql` reads that list from config; `--schemas` overrides it.

**@askdb/studio**: Resync passes the configured MySQL database list to the connector, so it matches `askdb introspect`.
