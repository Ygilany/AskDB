---
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
"@askdb/core": patch
"@askdb/client": patch
"@askdb/ai": patch
"@askdb/ai-openai": patch
"@askdb/ai-anthropic": patch
"@askdb/ai-azure": patch
"@askdb/ai-google": patch
"@askdb/rag": patch
---

Accept `ai` from 7.0.51 again, and `@ai-sdk/openai` from 4.0.29 for `@askdb/rag`'s embedding peer. The last dependency bump raised every `ai` range to `^7.0.113` and `@askdb/rag`'s `@ai-sdk/openai` peer to `^4.0.74`, though AskDB needs nothing newer. A host that pins an older `ai` couldn't install the release with npm (`ERESOLVE`), and pnpm gave AskDB a second AI SDK instead of the host's. These ranges now rise only when AskDB needs a newer version or a security fix, and the changelog says which (#403).
