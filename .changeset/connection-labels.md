---
"@askdb/connectors": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlserver": patch
"@askdb/sqlite": patch
"@askdb/prisma": patch
"@askdb/studio": patch
---

Fix a SQL Server password leak in Studio's introspection source label, and build connection labels from parsed parts at the connector registry instead of masking.

Studio's `redactUrl` relied on `new URL()`; for `sqlserver://host;database=db;user=sa;password=S3cret` (the Prisma/JDBC-style format) the non-special scheme parses with an opaque host that still contains the whole `;password=…` tail, so the password was shown in the UI.

A label is now built only from the host, port and database (or a file path) that the engine's own parser extracts cleanly; no other part of the connection string is ever copied into it. Adapters return those parts, never label text, and the registry always builds the label with `formatConnectionLabel`. Anything that doesn't parse cleanly, and any provider without a parser, gets `configured <engine> connection`. User names, passwords and query strings never appear. See `docs/adrs/0011-connection-labels-from-parsed-parts.md`.

- **@askdb/connectors**: `ConnectorProviderAdapter` gains an optional `connectionLabelParts(connection)` hook, and `ConnectorRegistry` gains `connectionLabel(provider, connection)`, which builds the label from those parts. New exports: `formatConnectionLabel(engine, parts)` (the allowlist every label passes through), `parseConnectionUrl(input, schemes)` (the standard URL form Postgres, MySQL and `mssql://` share), and the `ConnectionLabelParts` and `ConnectorConnection` types.
- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlserver**, **@askdb/sqlite**, **@askdb/prisma**: each connector provider adapter implements `connectionLabelParts`. Postgres and MySQL read their URL forms (`postgres://app:S3cret@db:5432/app` → `postgres://db:5432/app`); a libpq `key=value` string, a JDBC URL, or a quoted or malformed URL falls back. SQL Server reads `mssql://` URLs, the Prisma/JDBC `sqlserver://host:port;database=…` form and ADO.NET `Server=…;Database=…;` strings (→ `sqlserver://host:port/database`); a quoted or `{braced}` value with trailing text, a segment that isn't `key=value`, a repeated key, an `@` in the `sqlserver://` form, a named instance, or a spelling the driver's ADO.NET parser reads differently (an escaped `;;`, a value starting with `;`) falls back. SQLite shows a plain path, or only the path of a `file:` URI (its query string, where encryption keys go, is never read). Postgres export bundles and Prisma schema paths are shown as paths, through the same allowlist.
- **@askdb/studio**: `GET /api/introspect/status` serves `registry.connectionLabel()` as `sourceLabel` (for example `postgres://db:5432/app` or `configured sqlserver connection`); Studio no longer switches on the engine to build it.
