---
"@askdb/core": minor
---

`ask()` takes an `abortSignal` option that cancels the NL→SQL model call (`generateText({ abortSignal })`), e.g. `ask({ ..., abortSignal: AbortSignal.timeout(60_000) })`. With a built-in dialect or `DialectSpec`, an aborted call rejects with `SqlGenerationError` whose `cause` is the abort reason. A custom `AskDialect` receives the signal as `options.abortSignal` (new on `AskDialectGenerateOptions`) and maps its own errors. `generateSelectSql()`'s deps accept `abortSignal` too.
