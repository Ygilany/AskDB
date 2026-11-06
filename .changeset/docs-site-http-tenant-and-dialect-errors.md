---
"@askdb/docs-site": patch
---

The HTTP API docs name `500 tenant_scope_not_configured` for a schema with a tenant policy, and say the server refuses a schema whose `provider` has no AskDB dialect instead of generating PostgreSQL (#716, #720): the error table in the HTTP API reference, the deploy guide, and beta.48 upgrade entries.
