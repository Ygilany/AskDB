---
"@askdb/config": patch
---

`@askdb/config` tidies its internals before 1.0 (#712). Behavior and the public API are unchanged: config resolution, the flat env map, `bootstrapAskDbEnv` and every `askdb.config: …` error give the same results as before. The JSDoc on `flattenAskDbConfig` and `env()` now says which flat-map keys are written with a default (`ASKDB_RAG_EMBEDDER`, `ASKDB_INTROSPECT_OUT`, and with pgvector the index strategy and the mock embedder's dimensions) and which stay out until the config sets them.
