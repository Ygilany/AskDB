---
"@askdb/ai": patch
---

The "no language model configured" error now names `ai.language.model` in `askdb.config.*` first, then `ASKDB_AI_MODEL` or the provider's native model variable for a host that passes its own env map (#629). It used to name only `ASKDB_AI_MODEL`, which the config path never reads.
