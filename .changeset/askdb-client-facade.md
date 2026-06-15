---
"@askdb/client": minor
---

Add `@askdb/client`: a config-aware `createAskDb()` facade that resolves schema, model, and dialect from the runtime config so callers only pass a question. `schema`, `model`, and `dialect` remain optional per-call overrides. `ask()` in `@askdb/core` is unchanged and remains the pure, BYO-model primitive.
