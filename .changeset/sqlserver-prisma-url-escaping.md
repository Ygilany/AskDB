---
"@askdb/sqlserver": patch
---

Parse Prisma-style `sqlserver://` connection URLs with Prisma's own grammar, so a value escaped as Prisma documents is read correctly.

Prisma's SQL Server docs say to wrap a value containing `: \ = ; / [ ] { }` in curly braces, for example `password={Pass:Word;}`. `resolveConnectionInput()` ignored the braces and split on every `;`, so that password reached `mssql` as `{Pass:Word`, and a `;database=` inside a braced value replaced the real database. It now follows Prisma's JDBC-string parser (`prisma/connection-string`): `{…}` is read verbatim up to the first `}`, braced and plain runs join (`{abc;}}45}` is `abc;}45}`), keys are case-insensitive, Prisma's aliases (`initial catalog`, `username`, `uid`, `pwd`) apply, and a named instance (`host\instance`) is passed to `mssql` as `options.instanceName`. Strings Prisma rejects now throw a clear error instead of connecting with a misread value: an unclosed `{`, a segment that isn't `key=value` (including a quote-wrapped value holding `;`), an empty key or value, an unescaped `=` or `:` in a value, a non-numeric port, a non-ASCII character, or two aliases of the same setting. Whitespace around an unbraced key or value is still ignored.
