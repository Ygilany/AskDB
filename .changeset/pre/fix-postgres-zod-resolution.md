---
"@askdb/postgres": patch
---

Keep the Postgres AI SDK dependency resolved against the same Zod major used by AskDB core, avoiding duplicate AI SDK type instances in workspaces that also install Zod 4.
