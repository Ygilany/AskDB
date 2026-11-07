---
"@askdb/studio": patch
---

`askdb-studio --help` (and `askdb studio --help`) says "schema directory" instead of "Schema v2" (#273) and says Studio is experimental, with a link to ADR 0030 (#662). The pgvector RAG error names the config key to set, `rag.storeConfig.pgvector.databaseUrl`, instead of an internal `ASKDB_*` name (#629).
