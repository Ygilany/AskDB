---
"@askdb/docs-site": patch
---

The tenant-policy reference says to quote a tenant column with an upper-case non-ASCII letter on Postgres and CockroachDB, to write non-ASCII letters in the schema's case on MySQL, MariaDB and SQLite, to quote such an alias or qualifier on Postgres and CockroachDB, and that a name with U+0130, U+0131, U+017F, U+212A or not in NFC is refused unless the schema spells it. The upgrade notes cover the change.
