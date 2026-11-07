---
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

`MysqlIntrospectionInput`, `SqliteIntrospectionInput` and `SqlServerIntrospectionInput` are now aliases of `@askdb/introspect/kit`'s `LiveCatalogInput`, and each connector passes its input to `describe*` whole (#816). The shape is unchanged. A field added to `LiveCatalogInput` now reaches all three connectors, where each used to copy the fields by hand.
