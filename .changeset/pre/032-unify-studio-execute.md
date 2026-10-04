---
"@askdb/postgres": minor
"@askdb/mysql": minor
"@askdb/sqlite": minor
"@askdb/sqlserver": minor
"@askdb/studio": patch
---

**@askdb/{postgres,mysql,sqlite,sqlserver}**: Driver loaders (`createXxxCatalogQueryRunner`) now accept a `resolveFrom?: string` option for embedders that need to resolve the optional native peer from a directory other than `process.cwd()` (e.g. `@askdb/studio` running from an npx cache while the user project sits elsewhere). New `loadXxxDriver` and `isXxxDriverInstalled` helpers are exported for the same reason. `@askdb/sqlserver` additionally re-exports `resolveConnectionInput` and the `MssqlConfigInput` type so embedders can apply the same connection-string normalization the catalog runner uses. Behavior with no option / no helper import is unchanged.

**@askdb/studio**: SQL Server query execution now routes the connection string through `@askdb/sqlserver`'s `resolveConnectionInput` before constructing the `mssql.ConnectionPool`. Fixes `Failed to connect to localhost:1433 - self-signed certificate` failures on ADO.NET connection strings that use the spaced `Trust Server Certificate=True` form (the VS Code mssql / SSMS default), and adds support for `mssql://` and Prisma-style `sqlserver://` URLs — matching the introspect path. Internal: the execute registry now delegates driver loading and per-engine connection-string normalization to the `@askdb/<engine>` packages instead of re-implementing them, eliminating the drift surface that caused the TLS regression in the first place.
