---
"@askdb/studio": patch
---

Fix the Query Playground's Token Usage panel, which never rendered: `ai@6`'s `generateText` usage object reports `inputTokens`/`outputTokens` rather than the legacy `promptTokens`/`completionTokens` fields, so the studio server's usage collector always produced `null`. The panel also now renders below the query results section instead of above it.
