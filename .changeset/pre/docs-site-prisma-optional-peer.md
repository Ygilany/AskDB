---
"@askdb/docs-site": patch
---

Prisma users now install `@askdb/prisma` themselves. The install page, the Prisma guide, the quickstart's Prisma tab, the Studio page and the CLI reference say so, with the pnpm 11 `@prisma/engines` approval (`pnpm add --allow-build=@prisma/engines @askdb/prisma`). The package reference documents the connector registry's lazy entries, `registry.load()` and `connectorPackageMissingMessage()`.
