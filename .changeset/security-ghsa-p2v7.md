---
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-p2v7-pv8j-c264](https://github.com/Ygilany/AskDB/security/advisories/GHSA-p2v7-pv8j-c264)). The tenant check lower-cased or normalized some names differently from CockroachDB, so a scoped table's read could go unseen, or a column CockroachDB reads as another could count as the tenant column:

- **A name in NFC only before lower-casing.** CockroachDB lower-cases an unquoted name and then normalizes it to NFC, so `J` followed by U+030C reads as `ǰ`. Such an unquoted name is now refused as `UNICODE_ESCAPED_IDENTIFIER` unless the schema spells it exactly.
- **A final capital sigma.** CockroachDB lower-cases `Σ` to `σ`, which JavaScript's `toLowerCase` writes `ς` at the end of a word. The column-list rule and a derived table's items now match names letter by letter, as the table gate does.

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: an unquoted name the schema doesn't spell whose lower-cased letters aren't in NFC (write it as the schema does).
