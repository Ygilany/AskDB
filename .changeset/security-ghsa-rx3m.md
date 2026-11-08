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
- **Aliases and qualifiers** with an upper-case non-ASCII letter were still compared the Postgres way, so on CockroachDB an unquoted `Ö.agency_id` could tie the predicate to another source.
- **`İ` (U+0130), the Kelvin sign and names not in NFC as written:** CockroachDB and MySQL read `clİents` as `clients`, which the check never saw, and CockroachDB normalizes names to NFC.
- **A scoped table whose name starts or ends with a non-ASCII letter** (`ürün`, `café`) was never seen as mentioned, so its reads needed no predicate.

A name the engines of a reading read apart (read the Postgres way, an unquoted name with an upper-case non-ASCII letter) names nothing as a column, an alias, a qualifier or a CTE name. A name with a letter some engine folds into ASCII (U+0130, U+0131, U+017F, U+212A), or one that isn't in NFC as written, is refused as `UNICODE_ESCAPED_IDENTIFIER` unless the schema spells it exactly, and a table's name is found between characters that can't continue a name in any script.

Upgrade notes (breaking): SQL that passed before and now throws `TenantGuardrailError` under `strict`: read the Postgres way, an unquoted tenant column or discriminator with an upper-case non-ASCII letter (quote it, as the schema spells it); read the MySQL way or under `sqlite`, one whose non-ASCII letters are in another case than the schema's (write them as the schema does); read the Postgres way, an unquoted alias or qualifier with an upper-case non-ASCII letter (quote it); a name the schema doesn't spell that holds U+0130, U+0131, U+017F or U+212A, or isn't in NFC as written; and a read of a scoped table whose name starts or ends with a non-ASCII letter with no predicate.
