---
"@askdb/config": minor
"@askdb/core": minor
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
"@askdb/tui": minor
---

Add Google Gemini as a supported AI provider.

Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.
