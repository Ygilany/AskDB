---
"@askdb/config": patch
---

A config whose `ai.providerConfig.<provider>.baseUrl`, or deprecated `rag.embedderConfig.openai.baseUrl`, holds a username or password fails to load (#787). The `askdb.config:` error names the key and says to put the key in `apiKey` or send other credentials as headers. It never repeats the URL. Such a URL never worked, because `fetch` refuses it with an error that quotes the URL, credentials included.
