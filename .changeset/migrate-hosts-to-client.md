---
"@askdb/http-api": patch
"askdb": patch
---

Resolve schema, model, and dialect via the new `@askdb/client` facade instead of duplicating the logic in each host. No behavior change: same dialect precedence, mock-SQL path, and error responses.
