---
"@askdb/core": minor
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-rx3m-m5jr-pwch](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rx3m-m5jr-pwch)). The tenant check folded some names' letters differently from the engine, so a column the engine reads as another column could count as the tenant column, a discriminator or a `GROUP BY` key:

- **CockroachDB** lower-cases every letter of an unquoted name, where Postgres folds only ASCII ones; both are read the Postgres way.
- **MariaDB** keeps apart letters Unicode lower-casing merges, such as U+212A KELVIN SIGN and `k`.
- **SQLite** folds only ASCII letters, and a `HAVING` predicate's `GROUP BY` key was compared with Unicode lower-casing.

One function now reads a written name for every engine that shares the reading, and every name comparison uses it. A name those engines read apart names no column.

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: read the Postgres way, an unquoted tenant column or discriminator with an upper-case non-ASCII letter (quote it, as the schema spells it); and read the MySQL way or under `sqlite`, one whose non-ASCII letters are in another case than the schema's (write them as the schema does).
