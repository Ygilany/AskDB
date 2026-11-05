---
"@askdb/mysql": minor
"@askdb/sqlite": minor
"@askdb/sqlserver": minor
"@askdb/docs-site": patch
---

Stop exporting the internal catalog SQL from the MySQL, SQLite and SQL Server packages, before the 1.0 API freeze (#275, ADR 0030). Each connector still runs the same queries; only the export is gone. `@askdb/postgres` keeps its `POSTGRES_TEMPLATE_BUNDLE`, because the air-gapped export flow runs those templates by hand.

**Upgrade notes (breaking):**

- `@askdb/mysql`: `MYSQL_CATALOG_SQL` is no longer exported, with no replacement.
- `@askdb/sqlite`: `SQLITE_CATALOG_SQL` is no longer exported, with no replacement.
- `@askdb/sqlserver`: `SQLSERVER_CATALOG_SQL` is no longer exported, with no replacement.

These constants were undocumented and existed for the packages' own unit tests. To introspect, use the package's connector (`createMysqlConnector()`, `createSqliteConnector()`, `createSqlServerConnector()`) with its catalog query runner.

Internal cleanup with no API change: `@askdb/sqlserver`'s `foldSqlServerResult` is now private to its module, as the MySQL and SQLite fold functions already are (#597). The packages reference page no longer says these three packages ship catalog SQL templates.
