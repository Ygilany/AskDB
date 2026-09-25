---
"@askdb/client": minor
---

`createAskDb().ask()` now treats config `modes.omitSensitiveFromPrompt: true` as a floor. A per-call `omitSensitiveIdentifiersFromNlToSqlPrompt: true` still tightens a single call, but `false` no longer overrides an operator who turned the config on.

New per-call `abortSignal` override. It is passed through to the NL→SQL model call (`generateText({ abortSignal })`), so hosts can enforce timeouts, e.g. `askdb.ask(q, { abortSignal: AbortSignal.timeout(30_000) })`. An aborted call rejects with `SqlGenerationError`.
