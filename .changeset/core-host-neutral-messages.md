---
"@askdb/core": patch
---

`@askdb/core`'s messages give advice any host can follow (#719, #273). An empty question now says "Pass a non-blank natural-language `question`." instead of naming the CLI's `-q / --question`, and a schema with no tables says "Pass a `schema` with at least one table." instead of pointing at a folder in AskDB's repository. A `"version": 1` schema file now points at the schema artifact format on askdb.tools instead of a file in AskDB's repository, and `buildNlToSqlUserPrompt()`'s tenant-policy error says "schema artifact" instead of "v2 schema". The `SUPPORTED_ASKDB_LOG_LEVELS` doc comment names `logging.level`, not an `ASKDB_*` variable (#629). The README says "schema artifact" instead of "Schema v2".
