---
"@askdb/core": minor
---

`loadSchema()` warns about a key `schema.json` doesn't define, with a new `SchemaV2Warning` kind, `{ kind: "unknown_key", id, key, suggestion? }` (#690). `id` is `"schema.json"` for a top-level key, a table's or column's ID, or `<from>-><to>` for a relationship, and `suggestion` is the known key it is closest to (a case change or a small edit away, such as `sensitve` → `sensitive`). The key is still ignored, so the format stays forward-compatible, but a misspelled `sensitive` no longer loads silently. `readSchemaDirectory()` now keeps `schema.json` as written, unknown keys included, so a bundle warns like its directory.

Upgrade notes: code that switches over a warning's `kind` exhaustively needs a case for `unknown_key`.
