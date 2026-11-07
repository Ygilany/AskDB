---
"askdb": patch
---

`askdb init --rag-store pgvector` writes a config that reads the pgvector connection URL from `PGVECTOR_URL` by default, not `ASKDB_PGVECTOR_URL`, and names that variable in `.env.example`. `--pgvector-env` still picks another name. A config that already reads `env("ASKDB_PGVECTOR_URL")` keeps working.
