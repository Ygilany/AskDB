---
"@askdb/docs-site": patch
---

The RAG for large schemas guide has a diagram of indexing and retrieval, and says what the prompt holds under retrieval: each table a retrieved chunk points to, in full, instead of every table, with the retrieved text (#713). It no longer says retrieved chunks replace the DDL. The lock-file and chunk-id details move to links into the `@askdb/rag` API reference, the paragraph on sensitive chunks shrinks to what the index leaves out and a link to Privacy model, and "Read next" points to the `@askdb/rag` API instead of the package reference.
