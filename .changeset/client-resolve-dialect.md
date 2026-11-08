---
"@askdb/client": minor
---

New export `resolveDialect(schema, { override?, configDialect?, unknownDialect? })`, the rule `createAskDb()`'s `ask()` runs to pick a dialect (#886): the override, then the configured dialect, then the schema's `provider` when it's a built-in dialect id, then `"postgres"` for a schema with no provider. Any other provider throws `DialectNotSupportedError`, unless `unknownDialect` is `"fallback-postgres"`. It returns a `DialectResolution` and reads no config. `createAskDb()` now calls it, with the same behavior as before.
