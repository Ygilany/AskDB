---
---

Fix stale `@askdb/ai` export names in docs, examples, and smoke tests.

Published `@askdb/ai` exports shortened names (`createAiRegistry`, `resolveAiConfig`, `resolveEmbeddingConfig`, `aiKeyMissingMessage`, `aiProviderMissingMessage`), but READMEs, the `examples/ask-question` script, and ADR docs still referenced the old `createAskDb*` / `resolveAskDb*` / `askDb*` names that the package never actually exported — causing a `SyntaxError` for npm consumers.

Also extends `examples/installable-smoke` to import `@askdb/ai` and `@askdb/ai-openai` from packed tarballs and assert the canonical export names resolve at runtime, so this class of drift is caught by CI.
