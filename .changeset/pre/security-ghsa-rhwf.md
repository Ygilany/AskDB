---
"@askdb/core": patch
"askdb": patch
"@askdb/http-api": patch
"@askdb/studio": patch
---

Security fix ([GHSA-rhwf-7742-8hwj](https://github.com/Ygilany/AskDB/security/advisories/GHSA-rhwf-7742-8hwj)). The tenant check read a number written right against a keyword (`1.0OR`, `1OR`) as one word, and likewise a `$N` parameter (`$1OR`). MySQL and MariaDB end such a number after its decimal point or exponent, PostgreSQL 14 and earlier at its last digit, and PostgreSQL 14 and CockroachDB end a `$N` parameter at its last digit. So the check missed an `OR` that the engine read, and a tenant-scoped query could pass with its tenant predicate beside it. The check now ends a number where each engine does: after its decimal point or exponent on MySQL and MariaDB, where a name that starts with digits (`3d_models`) stays one name, and at its last digit on PostgreSQL and CockroachDB. Wherever the SQL may be read as Postgres (`postgres`, `cockroachdb`, a dialect id that is no built-in engine, or none), it refuses a `$N` parameter written against a word, as `NOT_SELECT_OR_WITH`. Enforce tenant isolation in the database (for example row-level security) regardless.
