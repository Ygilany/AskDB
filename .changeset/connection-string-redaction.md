---
"@askdb/connectors": patch
"@askdb/postgres": patch
"@askdb/mysql": patch
"@askdb/sqlserver": patch
"@askdb/sqlite": patch
"@askdb/studio": patch
---

Fix a SQL Server password leak in Studio's introspection source label, and add per-engine connection-string redaction.

Studio's `redactUrl` relied on `new URL()`; for `sqlserver://host;database=db;user=sa;password=S3cret` (the Prisma/JDBC-style format) the non-special scheme parses with an opaque host that still contains the whole `;password=…` tail, so the password was shown in the UI.

- **@askdb/postgres**, **@askdb/mysql**, **@askdb/sqlserver**, **@askdb/sqlite**: new `redactConnectionString(input: string): string` that knows each engine's formats — URL userinfo passwords and secret query params (all URL engines), libpq `password=` values (Postgres), Prisma/JDBC `;password=` (the text after the first `;` is never read as URL userinfo, so a password containing `@` is masked whole) and ADO.NET `Password=` / `Pwd=` including quoted and `{braced}` values (SQL Server). SQLite returns the path unchanged.
- **@askdb/connectors**: the shared building blocks — `redactConnectionStringGeneric`, `redactUrlConnectionString`, `redactUrlUserinfo`, `redactSecretKeyValues`, `isSecretConnectionKey`, `hasUrlScheme`, `REDACTED_SECRET`. They fail closed: URL userinfo runs to the last `@`, so a password with an unencoded `/`, `?`, `#` or `@` is masked whole (an `@` in the path or query over-masks), and `redactUrlConnectionString` masks userinfo and secret `key=value` pairs found in the same input together.
- **@askdb/studio**: the introspection source label now dispatches to the engine's `redactConnectionString` by provider, falling back to generic redaction. URL labels now show `user:****@host` instead of dropping userinfo and query entirely.
