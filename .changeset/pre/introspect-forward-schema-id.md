---
"@askdb/introspect": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

Every built-in connector adapter now passes `ConnectorConfig.schemaId` to its connector (#775). Only the Prisma adapter did, so `createConnector({ provider: "postgres" | "mysql" | "sqlite" | "sqlserver", schemaId })` returned a `SqlSchema` with `schemaId: "introspected"`. It now returns the ID you set, and `"introspected"` only when you set none. To carry it, `LiveCatalogInput`, `PostgresIntrospectionInput`, `MysqlIntrospectionInput`, `SqliteIntrospectionInput` and `SqlServerIntrospectionInput` gain an optional `schemaId`. `schema.json` is unchanged: it takes its ID from `RenderOptions.schemaId`.
