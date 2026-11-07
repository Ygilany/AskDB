---
"@askdb/docs-site": patch
---

Docs: a new "@askdb/config API" reference lists every export of `@askdb/config`, with `bootstrapAskDbEnv()`'s options and errors, the runtime snapshot's fields, and a diagram of how a setting reaches a run. The Configuration reference keeps only the config keys, and its environment-variable table now lists the names `askdb init` writes: `DATABASE_URL` for Postgres, MySQL and SQL Server, `SQLITE_FILE`, `ASKDB_PGVECTOR_URL`, and the gateway's `ASKDB_AI_MODEL`. The custom-provider walkthrough and each provider's reasoning setting move to "Bring your own model", and the `PORT` recipe to "Deploy as an HTTP service", which no longer claims an `ASKDB_SCHEMA_PATH` fallback (#713).
