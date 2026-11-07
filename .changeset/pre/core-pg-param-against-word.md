---
"@askdb/core": minor
---

The read-only check refuses a `$N` parameter written against a word (`$1INTO`, `$1FOR`) with `SQL_FORBIDDEN_KEYWORD` where the SQL may be read as Postgres: under `postgres`, `cockroachdb` and a dialect id that is no built-in engine (#665). It read the whole token as one parameter, so it never saw the keyword, which a server that ends the parameter at its last digit would run.

Upgrade notes (breaking): SQL that passed before and now throws `SQL_FORBIDDEN_KEYWORD` on those readings: a word written right after a `$N` parameter's digits. Put a space after the parameter.
