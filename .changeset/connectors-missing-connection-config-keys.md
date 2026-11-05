---
"@askdb/mysql": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

The `askdb introspect` error for a missing connection names only the `askdb.config` keys: `introspection.provider` set to the engine, and its `introspection.providerConfig.<engine>.databaseUrl` (or `.file` for SQLite). It no longer offers `ASKDB_INTROSPECT_*` or a `DATABASE_URL` fallback, which AskDB never reads from the environment (#281).
