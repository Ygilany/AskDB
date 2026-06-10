---
"@askdb/studio": patch
"@askdb/config": patch
---

Fix Studio execute endpoint not reading `databaseUrl` from `askdb.config.*`.

`POST /api/execute` was reading `ASKDB_STUDIO_DATABASE_URL` directly from `process.env`, which is never populated because `bootstrapAskDbEnv` intentionally does not mutate `process.env`. The studio now reads `studio.execute.databaseUrl` via `getAskDbRuntimeConfig()`.

`@askdb/config` gains `AskDbRuntimeStudioConfig` (exported) and a `studio` field on `AskDbRuntimeConfig`, making the studio database URL available through the typed runtime config accessor.
