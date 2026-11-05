---
"@askdb/docs-site": patch
---

The docs site and its `AGENTS.md` no longer call `@askdb/core` dialect-agnostic. Core owns the six built-in dialects, so `ask({ dialect: "postgres" })` needs no engine package (ADR 0029). The Prisma guide now lists the `dialect` id for each Prisma provider, and installs only `@askdb/core` and a model provider for SQL generation. The core API reference marks `cockroachdb` as outside the 1.0 support claim.
