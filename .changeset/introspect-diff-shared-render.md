---
"@askdb/introspect": patch
"askdb": patch
---

Fix `askdb introspect --diff` reporting `changed: true` against an untouched artifact.

`--diff` rendered its comparison body with `toV2SchemaJson(schema, schemaId)`, which dropped the connector-detected `provider` that `--out` writes, and it skipped the ID-anchored merge, so human-set `sensitive` flags in the existing `schema.json` also showed up as drift. In practice `--diff` said "changed" almost every time.

**@askdb/introspect**: new pure `renderSchemaV2Body(schema, { schemaId, provider?, existingArtifactDir? })` returns `{ json, body, warnings }` — the exact bytes `renderToSchemaV2` writes, including the merge with an existing artifact. `renderToSchemaV2` now writes through it. New `isSchemaV2Json(value)` is the check applied to an existing `schema.json` before that merge: the shape the merge reads, including that each `sensitive` flag is a boolean when present, so a non-boolean flag is no longer copied into the new artifact.

**askdb**: `--out`, `--print` and `--diff` all render through `renderSchemaV2Body`. `--diff` passes the connector's `provider` and merges with the existing artifact when the renderer accepts it as valid Schema v2 (an invalid `schema.json`, such as `{ "version": 2 }` with no tables, is compared without the merge and reported as changed, as before; any other merge error, such as malformed `tables/*.md` front matter, fails `--diff` the way it fails `--out`), and compares structurally so a key-reordered but equivalent file is not reported as changed.
