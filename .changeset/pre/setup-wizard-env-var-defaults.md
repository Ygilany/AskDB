---
"@askdb/studio": minor
"askdb": patch
---

**@askdb/studio**: the guided setup wizard reaches parity with `askdb init` — it now also asks for the AI model env var, RAG store (file/memory/pgvector), Studio execute config, and supports the Azure AI Foundry provider. Env var *name* fields (connection URL, AI key, AI model, pgvector, Studio execute connection) render as a pre-filled default and only become editable when clicked, instead of always showing an open text input. Fixes a bug where writing a config with `ragStore: "pgvector"` before `.env` was filled in returned a 500.

**askdb**: `askdb init`'s interactive wizard no longer prompts you to name env vars — it uses conventional defaults (`DATABASE_URL`, `OPENAI_API_KEY`, ...) and tells you in the summary/next-steps output that you can rename any `env("...")` call in the generated `askdb.config.ts` afterward.
