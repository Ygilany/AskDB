---
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-p2v7-pv8j-c264](https://github.com/Ygilany/AskDB/security/advisories/GHSA-p2v7-pv8j-c264)). The tenant check read some names differently from the engine, so a scoped table's read could go unseen, a column the engine reads as another could count as the tenant column, or a join could count through another table:

- **A name in NFC only before lower-casing.** CockroachDB lower-cases an unquoted name and then normalizes it to NFC, so `J` followed by U+030C reads as `ǰ`. Such an unquoted name is now refused as `UNICODE_ESCAPED_IDENTIFIER` unless the schema spells it exactly.
- **A name the schema spells in upper case.** The schema's spelling excused an unquoted name with `İ`, or one whose lower-cased letters aren't in NFC, though CockroachDB reads an unquoted `İTEMS` as `items` even beside a table `"İTEMS"`. It now excuses an unquoted name only when the name is lower-case and in NFC.
- **A final capital sigma.** CockroachDB lower-cases `Σ` to `σ`, which JavaScript's `toLowerCase` writes `ς` at the end of a word. The column-list rule and a derived table's items now match names letter by letter, as the table gate does.
- **A joined table in another case.** A join the check relied on counted a table by its name in any case, though Postgres reads `"CLIENTS"` as another table than `clients`. A joined table now counts only where every engine the dialect covers reads it as the schema's table.

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: an unquoted name the schema doesn't spell whose lower-cased letters aren't in NFC (write it as the schema does); an unquoted name with `İ`, `ı`, `ſ`, the Kelvin sign or one of those letters that the schema spells but that isn't lower-case and in NFC (quote it as the schema spells it); and a join the check relies on whose table is spelled otherwise than the schema spells it, quoted, or unquoted on MySQL, MariaDB or SQL Server (write it as the schema does).
