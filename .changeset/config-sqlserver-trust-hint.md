---
"@askdb/config": patch
"askdb": patch
"@askdb/studio": patch
---

`askdb init --database sqlserver` and Studio's guided setup no longer put `Trust Server Certificate=True` in the `.env.example` hint for the SQL Server connection string (#803). That key turned the certificate check off in AskDB, and the `mssql` driver ignored it because of the spaces, so a hint copied into production trusted any certificate in AskDB but not in a host's own `mssql` pool. The hint now leaves the key out, so AskDB and `mssql` both check the certificate by default. A second comment line says to add `TrustServerCertificate=True;`, spelled without spaces so both read it, for a development server with a self-signed certificate such as the SQL Server Docker image. An `.env.example` that `init` already wrote isn't changed.
