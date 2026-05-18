---
"@askdb/config": patch
---

Allow multiple provider configs in `providerConfig` simultaneously.

`providerConfig` now accepts configs for all providers as optional fields, while still requiring the one matching `provider`. This lets a single config object hold credentials for multiple providers and switch between them by changing only the `provider` field.
