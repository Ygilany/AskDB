---
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/config": patch
"@askdb/core": patch
"@askdb/prisma": patch
---

Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.
