# @askdb/prisma

## 0.2.0-beta.0

### Minor Changes

- d9d69bb: Add `@askdb/prisma`, a schema-file introspection connector that reads relational Prisma schemas and renders AskDB Schema v2 without connecting to a database.

  `askdb introspect` now supports `--engine prisma --prisma-schema <schema.prisma|schema-dir>` for `--out`, `--print`, and `--diff`. Prisma does not provide SQL templates because it introspects from schema files.

  Document Prisma as an integration package alongside Postgres.

### Patch Changes

- Updated dependencies [28d1b68]
- Updated dependencies [a90543b]
- Updated dependencies [d9d69bb]
- Updated dependencies [4e462eb]
  - @askdb/introspect@0.3.0-beta.0
