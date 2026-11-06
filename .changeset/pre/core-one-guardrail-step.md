---
"@askdb/core": patch
---

`@askdb/core` runs its SQL guardrails through one internal step before 1.0 (#711). `ask()`, `generateSelectSql()` and `bindPreparedQuery()` each make one call that picks the checks, decides, logs and throws, instead of repeating that sequence. Behavior and the public API are unchanged: the checks each function runs, the verdict, the thrown error and its precedence, the log events and the `tenantGuardrail` and `sensitiveGuardrail` results are the same.
