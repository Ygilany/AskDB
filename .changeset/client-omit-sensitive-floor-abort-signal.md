---
"@askdb/client": minor
---

`createAskDb().ask()` now treats config `modes.omitSensitiveFromPrompt: true` as a floor. A per-call `omitSensitiveIdentifiersFromNlToSqlPrompt: true` still tightens a single call, but `false` no longer overrides an operator who turned the config on.

`createAskDb().ask()` passes `@askdb/core`'s new `abortSignal` option through, so hosts can enforce timeouts, e.g. `askdb.ask(q, { abortSignal: AbortSignal.timeout(30_000) })`.
