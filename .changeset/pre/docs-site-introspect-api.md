---
"@askdb/docs-site": patch
---

New Introspection API reference (`reference/introspect-api`) covering every export of `@askdb/introspect`, `@askdb/introspect/kit`, `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver` and `@askdb/prisma` (#713). It sits after the `@askdb/rag` API in the sidebar. The package reference keeps each package's purpose and install, and links there for the API. Its "Engine adapters" section is now "Engine packages", the MySQL entry names MariaDB, and the Prisma entry no longer says to pair it with an engine for SQL generation. The Prisma guide says which five providers are supported, and Switch engines says how `introspection.schemas` differs by engine and lists `cockroachdb` among the Prisma providers.
