---
"@askdb/ai": minor
"@askdb/ai-openai": minor
"@askdb/ai-anthropic": minor
"@askdb/ai-google": minor
"@askdb/ai-azure": minor
"@askdb/core": minor
"@askdb/client": minor
"@askdb/rag": minor
"askdb": minor
"@askdb/http-api": minor
"@askdb/studio": minor
---

Upgrade the Vercel AI SDK integration to AI SDK 7.

This moves `ai` to `^7.0.51` and the first-party provider packages to their AI SDK 7-compatible majors:

- `@ai-sdk/openai` `^4.0.29`
- `@ai-sdk/anthropic` `^4.0.29`
- `@ai-sdk/google` `^4.0.33`
- `@ai-sdk/azure` `^4.0.30`

AI SDK 7 requires Node.js 22 or newer, so AskDB packages that expose or carry the AI SDK runtime now advertise `node >=22`. Core model calls now use the AI SDK 7 `instructions` option, and the Google adapter uses the renamed `createGoogle` provider factory.
