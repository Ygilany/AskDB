---
"@askdb/docs-site": patch
---

Docs: the multi-tenancy guide splits by type. "Scope queries to a tenant" (same URL) is the how-to, with a corrected Studio Playground step and a screenshot. "Scope to a tenant hierarchy" covers `subtree` scopes, with example comments that show the default mode's output. "Tenant policy format" holds the fields, what happens when the policy and the schema disagree, what the tenant check requires, and the SQL output modes. "Tenant isolation" explains the split between AskDB's check and the database, its known limits and the other engines. The policy body is described as RAG context, not part of the prompt's tenant block (#713).
