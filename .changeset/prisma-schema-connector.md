---
"@askdb/prisma": minor
"@askdb/cli": minor
"@askdb/introspect": patch
---

Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

`askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

Document Prisma as an integration package alongside Postgres.
