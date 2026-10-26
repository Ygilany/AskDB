---
"@askdb/rag": patch
---

`loadChunkerSourcesFromBundleJson()` reads bundles with `@askdb/core`'s `BundledSchemaV2` type instead of its own copy of the shape, so it follows the format core's loader defines. No runtime change.
