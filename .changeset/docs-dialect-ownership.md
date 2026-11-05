---
"@askdb/docs-site": patch
---

The docs site no longer calls `@askdb/core` dialect-agnostic. It owns the built-in dialects, so `ask({ dialect: "postgres" })` needs no engine package (ADR 0029). The Prisma guide now lists the `dialect` id for each Prisma provider, and installs only `@askdb/core` and a model provider for SQL generation.
