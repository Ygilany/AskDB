---
"@askdb/docs-site": patch
---

Docs: a new how-to, "Keep sensitive columns out of prompts", covers marking sensitive tables and columns, the omission setting on each surface, checking the SQL with `sensitiveGuardrail` and `validateSensitiveReferences()`, the database role and the RAG index. The privacy model stays the explanation of what reaches the model, and no longer says the model "doesn't know" omitted columns exist, since a sensitive table keeps its name and a tenant-policy column stays. "Run safely in production" points to the how-to, and its audit-logging sample passes a logger to `ask()` (#713).
