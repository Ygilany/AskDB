---
"@askdb/config": minor
---

A config whose `ai.providerConfig.<provider>.baseUrl` holds a username or password fails to load (#787, ADR 0036), even on a connection no section uses. The `askdb.config:` error names the key and never repeats the URL: put the key in `apiKey`, and for other credentials, such as a proxy's, build the model in code with the AI SDK provider's `headers` option. Such a URL never worked, because `fetch` refuses it with an error that quotes the URL, credentials included.
