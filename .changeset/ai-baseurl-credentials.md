---
"@askdb/ai": minor
---

A model base URL with a username or password is refused before any request (#787). `fetch` never sent such a URL: it failed with an error that quoted the whole URL, credentials included, which reached `SqlGenerationError` and the `askdb.pipeline.failed` log. `@askdb/ai` now throws the new `AiBaseUrlCredentialsError` when a provider's `resolveConfig` reads one from an env variable (`ASKDB_AI_BASE_URL` or the provider's own, such as `OPENAI_BASE_URL`), and when a built-in provider builds a model from an `AiConfig` whose `baseURL` has one. Its `setting` names the variable, or `baseURL`, and its message never repeats the URL. A value that doesn't parse as a URL counts when it holds an `@`.
