---
"@askdb/ai": minor
---

**Breaking:** `@askdb/ai` no longer picks an embedding model on the env path (#651). With an API key and no embedding model, `registry.resolveEmbeddingConfig(env)` and `registry.createEmbeddingModelFromEnv(env)` throw `<provider>: no embedding model configured. Set ai.embedding.model in askdb.config.* (or ASKDB_AI_EMBEDDING_MODEL).`, as the section path already refuses a missing model. Before, `openai` and `azure` fell back to `text-embedding-3-small` and `gateway` to `openai/text-embedding-3-small`, with a `DeprecationWarning` (code `ASKDB_AI_DEFAULT_EMBEDDING_MODEL`) that said the fallback goes at 1.0. Set `ASKDB_AI_EMBEDDING_MODEL`, the provider's embedding model variable or the `modelDefault` option to that model to keep the same embeddings.

`ProviderEnvSpec.defaultEmbeddingModel` is removed from the type, and the `BUILTIN_AI_PROVIDERS` entries' `env` no longer carry it. A custom adapter's spec that sets it no longer typechecks: remove it. The upgrade guide's beta.50 section shows each step.
