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
"@askdb/introspect": minor
"@askdb/mysql": minor
"@askdb/postgres": minor
"@askdb/prisma": minor
"@askdb/rag": minor
"@askdb/sqlite": minor
"@askdb/sqlserver": minor
---

CommonJS applications can now `require()` AskDB packages, where package resolution previously failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The minimum supported Node.js version is now 22.12, which provides unflagged `require(esm)` support. No runtime behavior or exported symbols changed.
