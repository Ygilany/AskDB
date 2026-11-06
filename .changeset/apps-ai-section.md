---
"askdb": patch
"@askdb/studio": patch
---

`askdb ask`, `askdb rag` and Studio build their models from the config's typed `ai.language` and `ai.embedding` sections, since `@askdb/config` no longer builds the AI env maps they read (#711). Behavior is unchanged: `askdb rag --embedder-model` still overrides `ai.embedding.model`, and a config that sets a key removed in this release fails to load with an error naming its replacement.
