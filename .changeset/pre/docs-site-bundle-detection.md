---
"@askdb/docs-site": patch
---

The `@askdb/core` API reference no longer says `loadSchema()` treats a file named `*.bundle.json` as a bundle. It loads any JSON object with a `bundled` key as a bundle, whatever the file's name (#713).
