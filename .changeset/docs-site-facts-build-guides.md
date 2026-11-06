---
"@askdb/docs-site": patch
---

The embed, deploy, enrich and enforce-tenancy guides match the code again (#713). The embed guide's samples now run generated SQL the way Run safely in production says: under a read-only role with a statement timeout, inside a read-only transaction, with the Express example capping rows and keeping error details in the server log. The result table lists `sensitiveGuardrail`, the overrides sentence says what a call can and can't override, and the dialect list has all six. The deploy guide says where the schema path and port come from, shows `usage` in the response and how correlation IDs work, and says a schema with a tenant policy can't be served over HTTP yet (#343, #277).
