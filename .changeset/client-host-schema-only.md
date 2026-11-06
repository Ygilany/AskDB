---
"@askdb/client": minor
---

`createAskDb()` reads its default schema from `host.schemaJson`, then `host.schemaPath`, and no longer falls back to `ASKDB_SCHEMA_JSON` or `ASKDB_SCHEMA_PATH` in `config.ai.aiEnv` (#711). `@askdb/config` writes those keys only from `host.*`, so the fallback mattered only for a runtime config built by hand: set `structured.host` there instead. `SchemaLoadError.source` names `host.schemaJson` or `host.schemaPath (<path>)`.
