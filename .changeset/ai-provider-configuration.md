---
"@askdb/core": minor
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

Add shared AI provider configuration for the bundled apps.

`@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.
