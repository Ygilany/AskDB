---
"@askdb/mysql": patch
---

Internal cleanup: `foldMysqlResult` is no longer exported from the connector's `describe` module (nothing outside tests used it), and the `MYSQL_CATALOG_SQL` doc comment no longer claims snapshot-based tests. No public API change.
