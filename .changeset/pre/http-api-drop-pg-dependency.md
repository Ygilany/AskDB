---
"@askdb/http-api": patch
---

**@askdb/http-api**: Drop the hard `pg` dependency. The server only generates and validates SQL — it never connects to a database — and nothing in the package imports `pg`, so installing `@askdb/http-api` no longer pulls in a Postgres driver. This matches the documented install model where database drivers (`pg`, `mysql2`, `better-sqlite3`, `mssql`) are optional peers that the host app installs only when it runs its own execution or live introspection code. Host apps that relied on `pg` arriving transitively through `@askdb/http-api` should add it to their own `package.json`.
