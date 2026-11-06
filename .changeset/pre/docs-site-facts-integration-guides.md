---
"@askdb/docs-site": patch
---

The switch-engines, bring-your-own-model, RAG, Prisma and agents guides match the code again (#713). The RAG guide no longer says retrieval waits for 30 chunks by default: with a retriever, `ask()` retrieves on every call unless you pass `totalSchemaChunkCount`, and the `retriever` rows in the core and client references now say so too. Switch engines covers MariaDB, says what a dialect changes, and says a `dialect` in the config wins over the artifact. Bring your own model has two wiring paths (not three rows under "two ways") and Google's default model. Prisma lists every schema location it probes and no longer claims live CockroachDB introspection. The agents page's tool sample is valid TypeScript, passes the tenant scope from your host, and the page says the CLI and HTTP API can't serve tenant-policy schemas yet.
