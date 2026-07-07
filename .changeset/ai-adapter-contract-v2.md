---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-azure": minor
"@askdb/ai-google": minor
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

Make AI provider adapters self-describing. Standalone `resolveAiConfig` and
`resolveEmbeddingConfig` moved onto `createAiRegistry()` registry instances, and
adapters now own their native env vars, aliases, defaults, and provider-specific
connection options.

`AiConfig.resourceName` and `AiConfig.apiVersion` were replaced by
`AiConfig.providerOptions`; Azure reads `resourceName` and `apiVersion` from
that bag. The `ai` package is now a peer dependency of `@askdb/ai` and all
first-party AI adapter packages.

Google behavior is now provider-correct: it no longer falls back to
`OPENAI_API_KEY_SECONDARY`, its default language model is `gemini-2.0-flash`,
and embeddings require an explicit Google embedding model instead of falling
back to OpenAI's `text-embedding-3-small`.
