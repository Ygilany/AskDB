---
"askdb": minor
---

`askdb introspect` exits 1 when the source has no tables or views to write (#337, ADR 0037), with `--out`, `--print` and `--diff` alike, where it used to exit 0 and write a `schema.json` with `tables: []` that `loadSchema` rejects. The message names the schema id, the engine and any `--schemas`, `--exclude-schemas` or `--tables` filters, and lists the likely causes. Nothing is written, so an existing artifact stays as it was.
