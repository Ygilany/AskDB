---
"askdb": patch
---

`askdb rag query --types` now validates against `CHUNK_TYPES` from `@askdb/rag` instead of the CLI's own copy (closes #1064).
