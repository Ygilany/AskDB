---
"@askdb/core": minor
"@askdb/rag": minor
---

Add the Phase 8 RAG layer.

`@askdb/rag` ships deterministic Schema v2 chunking, BYO embedder and vector store interfaces, in-memory/file/pgvector stores, lock-file based index reuse, and the `askdb-rag` CLI.

`@askdb/core` now accepts an optional `retriever` in `ask()`. When retrieval is used, core synthesizes a focused DDL block from retrieved schema chunks; without a retriever the existing full-DDL prompt path is preserved.
