---
"@askdb/sqlserver": patch
"@askdb/docs-site": patch
---

`encrypt` and `trustServerCertificate` read the same in `mssql://` and Prisma-style `sqlserver://` URLs (#596). `true`, `yes` and `1` are true, and `false`, `no` and `0` are false, in any case. Any other value fails closed: an unknown `encrypt` value turns encryption on, and an unknown `trustServerCertificate` value leaves the server certificate untrusted. A `sqlserver://` URL with `encrypt=yes` or `encrypt=1` now requires TLS; before, only `encrypt=true` did. A `sqlserver://` URL with `trustServerCertificate=yes` or `=1` now trusts the certificate, as `=true` does. An `mssql://` URL with an unknown `trustServerCertificate` value no longer trusts it.

An ADO.NET string is now any string that doesn't start with a scheme (`name://`), so a password or other value holding `://` no longer skips the normalisation of spaced keys such as `Trust Server Certificate=True` (#595). The connection label uses the same test.

The upgrade guide's next section lists the changes, and the SQL Server guide and the `@askdb/sqlserver` README name the accepted values.
