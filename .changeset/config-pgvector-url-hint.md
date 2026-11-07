---
"@askdb/config": patch
---

A pgvector store without `rag.storeConfig.pgvector.databaseUrl` now fails with a hint that says a variable the config already reads there, such as the one `askdb init` wrote to `.env.example`, is unset or blank (#713). The example stays `databaseUrl: env("PGVECTOR_URL")`. Before, a project that `askdb init` set up got only that example, which named a different variable from the one its config reads.
