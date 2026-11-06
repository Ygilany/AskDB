---
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

`askdb ask`, `askdb rag` and Studio build their models from the config's typed `ai.language` and `ai.embedding` sections, since `@askdb/config` no longer builds the AI env maps they read (#711). `askdb rag --embedder-model` still overrides `ai.embedding.model`. A config that sets a key `@askdb/config` 1.0.0-beta.19 removed (#765), such as `model` on an `ai.providerConfig` connection or `rag.embedder: "openai"`, now fails to load in the CLI, Studio and the HTTP API, with an error naming each key's replacement; the upgrade guide shows each one before and after.
