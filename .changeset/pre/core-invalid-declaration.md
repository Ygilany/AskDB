---
"@askdb/core": minor
---

`bindPreparedQuery()` refuses a stored template whose parameter declares a `type` or `cardinality` AskDB doesn't support, with `QueryParameterError` and the new reason `INVALID_DECLARATION` (#789). An unknown `type`, such as `"uuid"`, used to fail as a raw `TypeError` from the renderer. An unknown `cardinality` used to bind as `"one"`, and now throws. The check runs before any value is read, so a broken template is reported as one even when a value is also missing. The message names the parameter and the allowed values. Regenerate the template with `ask()`.
