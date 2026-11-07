---
"@askdb/introspect": minor
---

Introspection refuses to write an artifact with no tables (#337, ADR 0037). `loadSchema` rejects a `schema.json` with `tables: []`, so writing one only moved the failure to the next command, and re-introspecting a database that had lost its tables replaced a valid artifact with it. `renderSchemaV2Body`, and so `renderToSchemaV2` and `introspect()` with render options, now throw the new `EmptyIntrospectionError` when the schema renders no tables or views, after filters: an empty database, a Postgres schema with only enums or sequences, or filters that match nothing. Nothing is written, and an existing `schema.json` and `tables/*.md` stay as they were. The error carries `schemaId`, `provider` and `filters`, and its message names them and the likely causes, never the connection. `RenderOptions` gains an optional `filters`, read only to name them in that error.
