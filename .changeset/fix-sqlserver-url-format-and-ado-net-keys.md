---
"@askdb/sqlserver": patch
---

Fix SQL Server introspection failing with `The "config.server" property is required and must be of type string` when using `mssql://` or `sqlserver://` URL formats, and fix `Trust Server Certificate` (with spaces) being silently dropped from ADO.NET connection strings.

**Root causes:**
- mssql v12 switched to `@tediousjs/connection-string`, a pure ADO.NET `Key=Value;` parser. URL-format strings (`mssql://…`) silently produce an empty config — `server` is never set, causing the error at connect time.
- `@tediousjs/connection-string` v1.x schema keys omit spaces (`trustservercertificate`) but ADO.NET clients like VS Code's mssql extension emit them with spaces (`Trust Server Certificate`). After lowercasing the keys never match, so the option is dropped and TLS verification fails.

**Fixes:**
- `mssql://user:pass@host:1433/db` — parsed via `new URL()` into a config object.
- `sqlserver://host:1433;database=db;user=u;password=p` (Prisma format) — custom semicolon-separated parser.
- ADO.NET strings — multi-word keys normalised to their camelCase/no-space equivalents before passing to mssql (`Trust Server Certificate` → `TrustServerCertificate`, `Application Intent` → `ApplicationIntent`, etc.).
