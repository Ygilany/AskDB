---
"@askdb/docs-site": patch
---

The config reference no longer offers `:memory:` for `introspection.providerConfig.sqlite.file` (#712). Introspection opens the file read-only, which `better-sqlite3` refuses for an in-memory database, so the path must name an existing file.
