---
"@askdb/prisma": patch
"askdb": patch
---

**@askdb/prisma**: `@prisma/internals` is now loaded on the first `describePrismaSchema()` call instead of when `@askdb/prisma` is imported, so registering `prismaConnectorProvider` is cheap.

**askdb**: the CLI registers `prismaConnectorProvider` in its default connector registry again (so `--engine prisma` resolves through the registry like every other engine) without paying the `@prisma/internals` load cost on unrelated commands.
