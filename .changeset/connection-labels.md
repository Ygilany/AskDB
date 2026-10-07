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

- **@askdb/connectors**: `ConnectorProviderAdapter` gains an optional `connectionLabelParts(connection)` hook, and `ConnectorRegistry` gains `connectionLabel(provider, connection)`, which builds the label from those parts. New exports: `formatConnectionLabel(engine, parts)` (the allowlist every label passes through), `parseConnectionUrl(input, schemes)` (a strict standard-URL parser for third-party engines whose driver has no parser to reuse), and the `ConnectionLabelParts` and `ConnectorConnection` types. `formatConnectionLabel` also falls back when the parts aren't a plain object or a part isn't a string, and the registry falls back when a `connectionLabelParts` hook throws, so its message never becomes the label.
- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlserver**, **@askdb/sqlite**, **@askdb/prisma**: each connector provider adapter implements `connectionLabelParts`, taking host, port and database from the driver's own parser, so the label names what the connection will use. Postgres uses `pg-connection-string` (the parser `pg` uses; now an exact-version dependency of `@askdb/postgres`), including a `?host=` override (`postgres://app:S3cret@db:5432/app` → `postgres://db:5432/app`); a libpq `key=value` string, a JDBC URL, or a quoted or malformed URL falls back. MySQL reads `mysql://` URLs the way `mysql2`'s `parseUrl` does (WHATWG `URL`). SQL Server uses `resolveConnectionInput()` for `mssql://` URLs and Prisma's `sqlserver://host:port;database=…` form (now also reading Prisma's `{…}` escape for a value that holds a `;`; a `sqlserver://` string with `{`, a quote or an ambiguous `;` gets the fallback label), and `@tediousjs/connection-string` (the parser `mssql` uses; now an exact-version dependency of `@askdb/sqlserver`) for ADO.NET `Server=…;Database=…;` strings (→ `sqlserver://host:port/database`); a string the driver rejects, a named instance or pipe, or an `@` in the `sqlserver://` form falls back, and an ADO.NET value the driver reads as part of the password (after `;;`, a leading `;`, or Unicode whitespace) never becomes the database or server. An `@` or `#` after the host of a URL falls back for every engine. SQLite shows a plain path, or only the path of a `file:` URI (its query string, where encryption keys go, is never read). Postgres export bundles and Prisma schema paths are shown as paths, through the same allowlist.
- **@askdb/studio**: `GET /api/introspect/status` serves `registry.connectionLabel()` as `sourceLabel` (for example `postgres://db:5432/app` or `configured sqlserver connection`); Studio no longer switches on the engine to build it.
