---
"@askdb/config": patch
"askdb": patch
"@askdb/studio": patch
---

`askdb init --database sqlserver` and Studio's guided setup write `TrustServerCertificate=True` in the `.env.example` hint for the SQL Server connection string, where they wrote `Trust Server Certificate=True` (#803). AskDB reads both forms, but the `mssql` driver ignores the key with spaces, so a host that reused the hinted `DATABASE_URL` for its own `mssql` pool got a self-signed certificate error. An `.env.example` that `init` already wrote isn't changed: if you copied the hint, remove the spaces from the key.
