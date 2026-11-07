---
"@askdb/studio": patch
---

Studio's setup wizard writes a config that reads a pgvector store's connection URL from `PGVECTOR_URL` by default, not `ASKDB_PGVECTOR_URL`, matching `askdb init`. The variable field still takes another name. A config that already reads `env("ASKDB_PGVECTOR_URL")` keeps working.
