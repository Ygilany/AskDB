---
"@askdb/config": patch
---

Throw a clear `askdb.config:` error when a first-party provider (`openai`/`azure`/`foundry`/`google`/`anthropic`) is selected without its `providerConfig` branch, instead of crashing with a TypeError during config flattening.
