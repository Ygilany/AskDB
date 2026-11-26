---
"askdb": patch
"@askdb/studio": patch
---

Fall back to the "introspected" schema id when `askdb introspect` — or Studio's server-side run — derives an empty or dot-only name from the output directory: `--out .`, `--out ..`, `--out /` and `--out .schema` used to write ".", ".." or "" into schema.json (closes #782).
