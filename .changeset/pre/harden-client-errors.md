---
"@askdb/client": minor
"@askdb/http-api": patch
---

`@askdb/client` now throws typed errors and supports `unknownDialect: "throw" | "fallback-postgres"`. The HTTP API uses those error types to return 400 `schema_parse_error` for missing schema files and to preserve the postgres fallback for unrecognized schema providers.
