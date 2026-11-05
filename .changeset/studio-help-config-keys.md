---
"@askdb/studio": patch
---

`askdb-studio --help`, the README and the sample NL-to-SQL "no AI key" error name `studio.listen.port`, `studio.listen.host`, the `ai` block and `dev.mockSql` in `askdb.config` instead of `ASKDB_STUDIO_PORT`, `ASKDB_STUDIO_HOST`, `OPENAI_API_KEY`, `ASKDB_AI_MODEL` and `ASKDB_MOCK_SQL`, which Studio never reads from the environment (#281). A `studio.listen.port` that isn't an integer from 1 to 65535 now stops Studio with an error instead of quietly binding port 5556; a numeric string works like a number.
