---
"@askdb/docs-site": patch
---

The schema artifact page now matches the Schema v2 contract. Its `schema.json` example has the required `schema` field and the `provider` field, and it loads with no warnings. The page says that you can edit `schema.json` by hand, and that re-introspection keeps only your `sensitive` flags. It points marking a table or column sensitive at front-matter, because `schema.json` ignores a misspelled key. It also says that renaming a table or column changes its ID, so its enrichment and sensitivity marks stop applying, and how to find the `schema.json` marks that re-introspection drops. The page now says the file names in a schema directory are exact. It also says that with a tenant policy, the prompt carries a tenant policy block and the advisory `tenantScope.context` as well, with tenant IDs only as placeholders. "Author your schema" no longer says a renamed column keeps its ID.
