---
"@askdb/client": patch
"@askdb/ai": patch
"@askdb/ai-openai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai-google": patch
"@askdb/ai-azure": patch
---

Docs only: package READMEs now lead with the `createAskDb({ providers: [...] })` path — no direct `@askdb/ai` import — with the standalone `createAiRegistry` usage kept as the documented advanced alternative.
