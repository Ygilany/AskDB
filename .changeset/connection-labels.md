---
"@askdb/connectors": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlserver": patch
"@askdb/sqlite": patch
"@askdb/studio": patch
---

Fix a SQL Server password leak in Studio's introspection source label, and build connection labels from parsed parts instead of masking.

Studio's `redactUrl` relied on `new URL()`; for `sqlserver://host;database=db;user=sa;password=S3cret` (the Prisma/JDBC-style format) the non-special scheme parses with an opaque host that still contains the whole `;password=…` tail, so the password was shown in the UI.

A label is now built only from the host, port and database (or a SQLite file path) that the engine's own parser extracts cleanly; no other part of the connection string is ever copied into it. Anything that doesn't parse cleanly becomes `configured <engine> connection`. User names, passwords and query strings never appear. See `docs/adrs/0011-connection-labels-from-parsed-parts.md`.

- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlserver**, **@askdb/sqlite**: new `connectionLabel(input: string): string`. Postgres and MySQL read their URL forms (`postgres://app:S3cret@db:5432/app` → `postgres://db:5432/app`); a libpq `key=value` string, a JDBC URL, or a quoted or malformed URL falls back. SQL Server reads `mssql://` URLs, the Prisma/JDBC `sqlserver://host:port;database=…` form and ADO.NET `Server=…;Database=…;` strings (→ `sqlserver://host:port/database`); a quoted or `{braced}` value with trailing text, a segment that isn't `key=value`, a repeated key, an `@` in the `sqlserver://` form, or a named instance falls back. SQLite shows a plain path, or only the path of a `file:` URI (its query string, where encryption keys go, is never read).
- **@askdb/connectors**: the shared pieces — `formatConnectionLabel(engine, parts)` (the allowlist every label passes through) and `parseConnectionUrl(input, schemes)` (the standard URL form Postgres, MySQL and `mssql://` share), plus the `ConnectionLabelParts` type.
- **@askdb/studio**: `GET /api/introspect/status` serves the engine's `connectionLabel` as `sourceLabel` (for example `postgres://db:5432/app` or `configured sqlserver connection`).
