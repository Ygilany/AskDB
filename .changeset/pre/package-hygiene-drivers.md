---
"@askdb/http-api": patch
"@askdb/studio": patch
---

**@askdb/http-api**: drop the unused `@askdb/postgres` dependency — nothing in the HTTP API imports it (it returns SQL and never connects to a database). The `pg` dependency was already dropped separately.

**@askdb/studio**: align the optional driver peer ranges with the engine packages that actually load them — `better-sqlite3 >=12` (was `>=9`) and `mssql >=12` (was `>=10`). The dev dependencies already matched.
