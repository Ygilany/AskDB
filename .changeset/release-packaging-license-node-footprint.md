---
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/ai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai-azure": patch
"@askdb/ai-google": patch
"@askdb/ai-openai": patch
"@askdb/client": patch
"@askdb/config": patch
"@askdb/connectors": patch
"@askdb/core": patch
"@askdb/enrich": patch
"@askdb/introspect": patch
"@askdb/mysql": patch
"@askdb/postgres": patch
"@askdb/prisma": patch
"@askdb/rag": patch
"@askdb/sqlite": patch
"@askdb/sqlserver": patch
---

Release packaging fixes:

- Ship `LICENSE` and `NOTICE` in `@askdb/ai`, `@askdb/ai-anthropic`, `@askdb/ai-azure`, `@askdb/ai-google`, `@askdb/ai-openai`, `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` (they were listed in `files` but missing from the tarballs).
- `@askdb/studio`: React, Radix UI, lucide-react, react-router, clsx, tailwind-merge, and class-variance-authority are bundled into the prebuilt browser client, so they are now dev dependencies and are no longer installed with the package.
- Add `"sideEffects": false` to library packages (`@askdb/rag` lists its bin entry as side-effectful), and point `homepage` at the relevant askdb.tools page.
- Package READMEs no longer link to repo-relative paths that npmjs.com cannot resolve.
