---
"@askdb/docs-site": patch
---

The privacy model, the core and client API references, the RAG guide and `/AGENTS.md` say what omitting sensitive identifiers removes: sensitive columns and any description, alias, enum value, common query language or retrieved chunk text that names one, while a sensitive table keeps a one-line placeholder with its name. The privacy model also says that a tenant policy's rules stay in the prompt, so a sensitive column they name still reaches the model. The core API reference documents `sensitiveMentionNames(schema)` and no longer says omission strips sensitive table names (#374).
