---
"@askdb/sqlite": patch
---

`createSqliteCatalogQueryRunner`'s JSDoc no longer offers `:memory:` for an empty database (#712). The runner opens the file read-only, which `better-sqlite3` refuses for an in-memory database, so `:memory:` and a missing file both throw on the first query. Behavior is unchanged.
