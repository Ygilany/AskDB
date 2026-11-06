---
"@askdb/docs-site": patch
---

The privacy model, `/AGENTS.md`, the Studio page and the homepage now state what reaches the model exactly (#283). With a tenant policy, the prompt carries the policy and `tenantScope.context` (role, label, description, `attributes`) and a `global` scope's `reason`, but never the tenant IDs, which are `:tenant_*` placeholders bound after generation. Values reach the prompt only as text in the schema artifact (an `enum` list, a description) or in the question. The privacy model adds what an embedding provider receives with `@askdb/rag`, and that Studio's Playground keeps its history in `playground-history.json`. `/AGENTS.md` says the CLI and HTTP API can't serve a tenant-policy schema yet (#277), that Studio's Playground can run SQL when execute is on, and that the database, not AskDB's lint, enforces tenant isolation.
