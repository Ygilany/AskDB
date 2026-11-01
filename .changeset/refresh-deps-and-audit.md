---
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/config": patch
"@askdb/core": patch
"@askdb/prisma": patch
"@askdb/ai-openai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai-azure": patch
"@askdb/ai-google": patch
---

Refresh runtime dependencies to their latest patch and minor versions (`@ai-sdk/*`, `@inquirer/prompts`, `dotenv`, `zod`, `@prisma/internals`). Peer ranges and the `ai` ranges don't move (ADR 0015); this changes only what AskDB itself installs.
