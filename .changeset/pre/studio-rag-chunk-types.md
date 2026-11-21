---
"@askdb/studio": patch
---

The RAG Index query debugger's `tenant-policy` chunk type now filters. Studio's server accepted only the six chunk types that existed before tenant policies were indexed, so a query with only `tenant-policy` checked came back with every type. The server and the page now share one list of chunk types, and `/api/rag/query` answers 400 for a type it doesn't know instead of dropping it (closes #1047).
