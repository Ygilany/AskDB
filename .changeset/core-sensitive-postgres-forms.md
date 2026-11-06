---
"@askdb/core": minor
"@askdb/docs-site": patch
---

The sensitive check fails closed on a Postgres Unicode-escaped name and on an `E'…'` string continued on a later line, with the new `SensitiveScopeIssue` members `UNICODE_ESCAPED_IDENTIFIER` and `STRING_CONTINUATION` (#707, ADR 0012). Under a custom `AskDialect`, which skips the read-only check, or a direct `validateSensitiveReferences()` call, `SELECT U&"p\0061ssword" FROM users` and a `u.password` read after a continued `E'…'` string passed: the check matched names as written, and Postgres reads both differently. The check now runs the same detectors as the read-only and tenant checks, under `postgresReadingProfiles`, and reports these in `unresolvedScope` with `passed: false`, so `strict` mode throws `SensitiveReferenceError`.

**Upgrade notes:** a `switch` that lists every `SensitiveScopeIssue` needs both new cases. Built-in dialects already reject the same SQL in the read-only check.

The docs add both issues to the `core-api` scope table, Safety boundaries and the sensitive-fields contract.
