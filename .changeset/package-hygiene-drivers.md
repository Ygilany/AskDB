---
"@askdb/http-api": patch
"@askdb/studio": patch
---

**@askdb/http-api**: drop the unused `@askdb/postgres` and `pg` dependencies — nothing in the HTTP API imports them (it returns SQL and never connects to a database), so installing it no longer pulls in a Postgres driver.

**@askdb/studio**: align the optional driver peer ranges with the engine packages that actually load them — `better-sqlite3 >=12` (was `>=9`) and `mssql >=12` (was `>=10`) — and bump the matching dev dependencies.
