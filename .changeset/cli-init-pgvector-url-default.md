---
"askdb": patch
---

`askdb init --rag-store pgvector` reads the pgvector connection URL from `PGVECTOR_URL` by default, not `ASKDB_PGVECTOR_URL`, in the config it writes and in `.env.example`. `--pgvector-env` still picks another name. A config that already reads `env("ASKDB_PGVECTOR_URL")` keeps working.
