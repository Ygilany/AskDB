---
"@askdb/postgres": patch
---

Fix three Postgres introspection edge cases. An index column list given as a quoted `text[]` literal (`{"a,b",c}`) no longer splits at a comma inside quotes. The live catalog queries now keep a user schema such as `pgxtoast` instead of treating it as `pg_toast` (the `_` in their `LIKE` patterns matched any character), as the export-bundle path already did. View columns are ordered by `ordinal_position`, as table columns are (#552).
