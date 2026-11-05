---
"@askdb/studio": patch
---

Studio's Playground and **Suggest** buttons now follow `modes.omitSensitiveFromPrompt`, as `@askdb/client`, the CLI and the HTTP API do (#601, #625, ADR 0026). The Playground (`POST /api/ask`) passes the setting to `ask()`, so with it on the prompt no longer lists sensitive columns or text that names one. Enrichment suggestions (`POST /api/suggest`) now read the loaded schema, so a column marked sensitive in table front-matter (what the Sensitivity tab writes) or through a sensitive table is tagged `(sensitive)` like one marked in `schema.json`, and every one of them is left out when the setting is on; a sensitive table keeps only its name. With the setting on, **Suggest** on a sensitive column answers `400` with a message that names no column, and calls no model.
