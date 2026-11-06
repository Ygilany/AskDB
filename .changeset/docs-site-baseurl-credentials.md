---
"@askdb/docs-site": patch
---

The config reference says a model `baseUrl` can't hold a username or password, including on an unused connection or in `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`, and how to send credentials instead. The packages reference lists `AiBaseUrlCredentialsError`, and the upgrading guide notes the change under beta.50 (#787).
