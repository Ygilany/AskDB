---
"@askdb/config": patch
---

The JSDoc for `introspection.providerConfig.sqlite.file` no longer offers `:memory:` for an empty database (#712). Introspection opens the file read-only, which an in-memory database can't be, so the path must name an existing file. Behavior is unchanged.
