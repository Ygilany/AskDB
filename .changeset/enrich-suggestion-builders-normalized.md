---
"@askdb/enrich": minor
---

**Breaking:** `buildSuggestionTarget(schema, source)` and `buildSuggestionContext(schema, tableId)` take `loadSchema()`'s `NormalizedSchemaV2` instead of a `Workspace` (#625, ADR 0026). They used to hand the enrichment prompt the raw `schema.json` tables, so a column marked sensitive in table front-matter, or through a sensitive table, wasn't treated as sensitive. The target and neighbor tables now carry the loader's effective `sensitive` flags, and an untracked table (`tracked: false`) is no longer listed as a neighbor, as it isn't in `ask()`'s prompt.

**Upgrade notes:** pass `loadSchema(workspace.schemaDir)` where you passed the workspace.
