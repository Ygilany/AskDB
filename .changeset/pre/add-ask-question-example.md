---
---

Add `examples/ask-question` — a standalone Node.js/Bun script showing how a downstream consumer imports `@askdb/core` and `@askdb/rag` to translate a natural-language question into SQL.

Demonstrates the full recommended pattern: `bootstrapAskDbEnv` + `askdb.config.ts` for configuration, `loadSchema` for schema loading, `createAskDbLanguageModelFromEnv` for model setup, and an optional RAG path using `buildSchemaIndex` + `createAiSdkEmbedder` with an in-memory store.

Also adds `examples/*` to `pnpm-workspace.yaml` so the example resolves workspace packages during development.
