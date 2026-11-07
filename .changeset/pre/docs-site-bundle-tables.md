---
"@askdb/docs-site": patch
---

The schema artifact format page and the `@askdb/core` API reference say a bundle's `tables` is required, `{}` when there are no table files. The `@askdb/rag` reference says `loadChunkerSourcesFromBundleJson()` throws `SchemaParseError` for such a bundle, and the upgrading guide notes the change under beta.50 (#797).
