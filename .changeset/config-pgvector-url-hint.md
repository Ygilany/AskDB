---
"@askdb/config": patch
---

A pgvector store without `rag.storeConfig.pgvector.databaseUrl` now fails with a hint naming `env("ASKDB_PGVECTOR_URL")`, the variable `askdb init` writes, where it suggested `env("PGVECTOR_URL")`. It also says that a variable the config already reads there is unset or blank, the usual cause in a project `askdb init` set up (#713).
