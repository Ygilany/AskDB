# @askdb/studio

Local browser UI for editing AskDB Schema v2 enrichment.

```sh
askdb-studio --schema ./my-app.schema
# or through the main CLI
askdb studio --schema ./my-app.schema
```

Studio serves a local web app at `http://127.0.0.1:5556` by default. It can:

- browse all physical tables and columns in `schema.json`
- edit table descriptions, aliases, primary entities, tags, common query language, example questions, and column metadata
- write the describable layer back to `tables/*.md`
- request AI enrichment suggestions when `OPENAI_API_KEY` is configured
- generate sample Postgres SQL for natural-language questions against the currently saved enrichment

Environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables AI suggestions and sample NL-to-SQL generation. |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible base URL. |
| `ASKDB_STUDIO_MODEL` | Studio-specific model override. Falls back to `ASKDB_MODEL`, `OPENAI_MODEL`, then `gpt-4o-mini`. |
| `ASKDB_STUDIO_HOST` | Bind host. Defaults to `127.0.0.1`. |
| `ASKDB_STUDIO_PORT` | Bind port. Defaults to `5556`. |
| `ASKDB_MOCK_SQL` | Deterministic generated SQL for tests or offline demos. |
