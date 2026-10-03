---
"@askdb/core": minor
---

Export the `BundledSchemaV2` type: the shape of the single-file bundle that `askdb bundle` writes and `loadSchema()` / `loadSchemaFromJson()` read (`bundled`, `physical`, `tables`, `concepts?`, `tenantPolicy?`). Writers such as `@askdb/enrich`'s `bundleSchemaDirectory()` now use this type, so the bundler and the loader can't disagree about which files a bundle carries.
