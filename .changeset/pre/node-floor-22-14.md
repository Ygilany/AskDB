---
"@askdb/ai": minor
"@askdb/ai-anthropic": minor
"@askdb/ai-azure": minor
"@askdb/ai-google": minor
"@askdb/ai-openai": minor
"@askdb/client": minor
"@askdb/config": minor
"@askdb/connectors": minor
"@askdb/core": minor
"@askdb/enrich": minor
"@askdb/http-api": minor
"@askdb/introspect": minor
"@askdb/mysql": minor
"@askdb/postgres": minor
"@askdb/prisma": minor
"@askdb/rag": minor
"@askdb/sqlite": minor
"@askdb/sqlserver": minor
"@askdb/studio": minor
"askdb": minor
---

Raise the supported Node floor from `>=22.12` to `>=22.14` (`engines.node` in every published package). `better-sqlite3` 13, which the `@askdb/sqlite` and `@askdb/studio` peer ranges allow, segfaults on Node 22.12.0 through 22.13.1 and works from 22.14.0 (bisected on linux-x64; upstream WiseLibs/better-sqlite3#1514). Hosts on Node 22.12 or 22.13 should upgrade to Node 22.14 or newer.
