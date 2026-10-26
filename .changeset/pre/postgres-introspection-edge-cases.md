---
"@askdb/postgres": patch
---

Fix three Postgres introspection edge cases. An index column list given as a quoted `text[]` literal (`{"a,b",c}`) no longer splits at a comma inside quotes. The live catalog queries now keep a user schema such as `pgxtoast` instead of treating it as `pg_toast` (the `_` in their `LIKE` patterns matched any character), as the export-bundle path already did, and the export-bundle path now keeps a user schema such as `information_schema_x` instead of treating it as `information_schema`, as the live path already did. View columns are ordered by `ordinal_position`, as table columns are (#552).
