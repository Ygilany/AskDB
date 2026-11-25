---
"@askdb/ai": patch
"@askdb/config": patch
"@askdb/core": patch
"@askdb/introspect": patch
"@askdb/mysql": patch
"@askdb/prisma": patch
"@askdb/enrich": patch
"askdb": patch
"@askdb/studio": patch
---

Internal: remove unused imports and variables that the new repo-wide oxlint run found, and build zero-filled vectors with `Array.from`. No behavior changes.
