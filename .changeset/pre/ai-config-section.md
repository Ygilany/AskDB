---
"@askdb/ai": minor
---

`@askdb/ai` resolves a typed config section as well as an env map (#711). A host with an `askdb.config.*` file passes `getAskDbRuntimeConfig().ai.language` or `.ai.embedding` from `@askdb/config` as it is, and no env map sits in between:

- **Registry methods:** `resolveAiConfigFromSection(section)`, `resolveEmbeddingConfigFromSection(section)`, `createLanguageModelFromSection(section)` and `createEmbeddingModelFromSection(section, options?)`, which asks for the section's `dimensions` unless `options.dimensions` is set. Each returns `undefined` when the connection has no API key, as the env methods do.
- **`resolveReasoningEffortFromSection(reasoning, purpose, override?)`** reads `ai.language.reasoning`: the override, then the purpose's own effort (`nlToSql` or `enrichment`), then `effort`.
- **Section types:** `AiLanguageSection`, `AiEmbeddingSection`, `AiConnectionSection`, `AiReasoningSection` and `AiModelSection`. They're structural, so `@askdb/ai` doesn't depend on `@askdb/config`.
- **Adapters:** each built-in provider maps a section to its `AiConfig` next to its env spec, through the new optional `AiProviderAdapter.resolveConfigFromSection(section, { usage })`. A custom adapter without it gets the section through the universal `ASKDB_AI_*` keys, passed to its `resolveConfig`.

The section path differs from the env path in three ways: an embedding section with a key but no model throws instead of falling back to the deprecated default embedding model; a provider the registry doesn't have fails with the message that says how to register it; and a `connection.baseUrl` with a username or password throws `AiBaseUrlCredentialsError` (`setting: "connection.baseUrl"`) whether or not the connection has a key (ADR 0036). A section and an env map holding the same settings give the same `AiConfig`. The env path (`resolveAiConfig(env)`, `createLanguageModelFromEnv(env)` and the rest) is unchanged for hosts without a config file.
