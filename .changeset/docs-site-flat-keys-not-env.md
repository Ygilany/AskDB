---
"@askdb/docs-site": patch
---

The configuration reference no longer documents internal flat keys as environment variables: the `studio.execute` table drops its "Env key" column, `ai.language.modelFamily` drops the `ASKDB_AI_AZURE_MODEL_FAMILY` alternative, and a note says `rt.flat` and `rt.ai.aiEnv` hold read-only keys AskDB builds from your config. The page names `ASKDB_DEBUG` as the one AskDB variable read from the environment. The client and core API references drop the `ASKDB_SCHEMA_*` and `ASKDB_MODE` variables (#282).
