---
"@askdb/docs-site": patch
---

New how-to, Connect to SQL Server (`guides/connect-to-sql-server`), under Guides → Build (#713). It covers the three connection-string formats, introspecting, the self-signed certificate error in development and production, and connecting your own `mssql` pool, which reads only ADO.NET strings or a config object, and `TrustServerCertificate=True` only without spaces. Switch engines links there instead of holding the connection and TLS sections, and its `mssql.connect()` example says the string must be ADO.NET. The troubleshooting entry for the TLS error links there and no longer shows an `mssql://` URL as the driver's format. `--use-system-ca` is no longer said to need Node 24.3: Node 22.23.4 accepts it. The brace rules for Prisma-style strings move to the `@askdb/sqlserver` reference.
