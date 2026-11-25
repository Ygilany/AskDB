---
"@askdb/rag": minor
---

Export `CHUNK_TYPES` and `isChunkType` from `@askdb/rag`: the runtime list of chunk types, with `ChunkType` derived from it, plus a guard for validating a value. The CLI and Studio now use these instead of their own copies (closes #1064).
