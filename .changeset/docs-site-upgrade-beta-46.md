---
"@askdb/docs-site": patch
---

The upgrade guide's 1.0.0-beta.46 section adds four entries and a list of other changes: schema file names must match exactly on every OS (#608), Prisma users install `@askdb/prisma` themselves (#259), locking reads fail with `SQL_LOCKING_READ` (#319), and writes refuse a symbolic link at `schema.json` (#617). The other changes cover config loading, Studio's port check and `askdb introspect --out`'s tenant-policy check.
