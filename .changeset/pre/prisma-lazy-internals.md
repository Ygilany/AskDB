---
"@askdb/prisma": patch
"askdb": patch
---

`@askdb/prisma` now loads `@prisma/internals` on the first `describePrismaSchema()` call (or the first `describe()` of a connector from `createPrismaConnector()`), not when the package is imported. Hosts that register `prismaConnectorProvider`, as the `askdb` CLI and Studio do, no longer pay for Prisma on every start: `askdb --help` loads no `@prisma/*` module and starts in about half the time (0.27s to 0.14s median on one machine). Introspecting a Prisma schema works as before.
