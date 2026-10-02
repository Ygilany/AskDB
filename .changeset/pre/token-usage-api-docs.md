---
"@askdb/core": minor
"@askdb/http-api": minor
"@askdb/studio": patch
---

Surface token usage through the full AskDB stack and add comprehensive API reference documentation.

**@askdb/core** — new `AskUsage` type (`promptTokens`, `completionTokens`, `totalTokens`); `generateSelectSql` now captures token usage from the `generateText` result; `AskDialectGenerateResult` and `AskPipelineResult` both include `usage?: AskUsage`; exported from the package index.

**@askdb/http-api** — `POST /ask` success response now includes `usage: AskUsage | null`.

**@askdb/studio** — Token usage re-added to the Query Playground (was dropped in the IA redesign migration); `UsageSummary` extracted to a shared component used by both the Playground and RAG Index page; display now correctly shows Prompt, Completion, and Embeddings rows individually.
