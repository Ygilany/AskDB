---
"@askdb/config": patch
"askdb": patch
"@askdb/studio": patch
---

`askdb init --database sqlserver` and Studio's guided setup write `TrustServerCertificate=True` in the `.env.example` hint for the SQL Server connection string, where they wrote `Trust Server Certificate=True` (#803). AskDB reads both forms, but the `mssql` driver ignores the key with spaces, so a host that reused the hinted `DATABASE_URL` for its own `mssql` pool got a self-signed certificate error. A second comment line now says the key skips the certificate check: keep it for a development server with a self-signed certificate, and remove it for a server with a CA-signed one. An `.env.example` that `init` already wrote isn't changed.
