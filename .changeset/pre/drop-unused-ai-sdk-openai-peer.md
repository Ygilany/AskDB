---
"@askdb/rag": patch
---

Drop the unused `@ai-sdk/openai` optional peer: the only code that used it, `createOpenAiEmbedder`, was removed in #847, so nothing in `@askdb/rag` loads the package (closes #849).
