---
"@askdb/docs-site": patch
---

The schema artifact page now matches the Schema v2 contract. Its `schema.json` example has the required `schema` field and the `provider` field, and it loads with no warnings. The page says that you can edit `schema.json` by hand, and that re-introspection keeps only your `sensitive` flags. It also says that renaming a table or column changes its ID, so its enrichment and sensitivity marks stop applying. The page now says the file names in a schema directory are exact. "Author your schema" no longer says a renamed column keeps its ID.
