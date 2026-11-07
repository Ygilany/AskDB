---
"@askdb/ai": patch
---

The "no language model configured" and "no embedding model configured" errors from the env path now name the config key first, `ai.language.model` or `ai.embedding.model` in `askdb.config.*`, then `ASKDB_AI_MODEL` / `ASKDB_AI_EMBEDDING_MODEL` or the provider's native variable for a host that passes its own env map (#629). The language error used to name only `ASKDB_AI_MODEL`, which a config file never sets.
