---
"@askdb/core": minor
"@askdb/introspect": minor
"@askdb/enrich": patch
"@askdb/studio": patch
"askdb": patch
"@askdb/docs-site": patch
---

Every AskDB write into a schema directory now refuses symbolic links (#617, ADR 0028).

- New `@askdb/core` export: `saveSchemaFile(schemaDir, relativePath, content)` writes one file inside a schema directory. It refuses a symbolic link at the file or at a directory between it and the schema directory (such as `tables/`), and a `relativePath` with an empty, `.` or `..` part or a NUL byte. It writes a temp file next to the target, with the target's permission bits, group and, where allowed, owner, and renames it over the target, so a hard link is replaced instead of written through and the write is atomic. A read-only target is refused with `EACCES`. The schema directory itself may be a symbolic link. This is the helper `@askdb/enrich`'s saves used since #372, moved to core so every writer shares it.
- `@askdb/introspect`: `renderToSchemaV2()`, and so `introspect()` with render options, writes `schema.json` through `saveSchemaFile()`. A `schema.json` that is a symbolic link now throws `Refusing to write schema.json outside the schema directory: "schema.json" is a symbolic link`. Before, the write went to the file the link pointed at.
- `askdb`: `askdb introspect --out` fails the same way on a linked `schema.json`.
- `@askdb/studio`: Playground history (`playground-history.json`, saved on every generate and on delete) and the `.gitignore` entry Studio adds for it are written through `saveSchemaFile()`, and so is `schema.json` on **Resync schema**. A linked history file fails the request with the refusal message. A linked `.gitignore` is left as it is and the history still saves, as with any `.gitignore` failure before. A dangling link at `.gitignore` no longer creates the file it names.
- `@askdb/enrich`: `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` call core's `saveSchemaFile()`; the behavior is unchanged. The refusal for a table now reads `Refusing to write tables/orders.md outside the schema directory: …` instead of `Refusing to write table markdown outside tables/: …`. The check on a table filename keeps its message.

**Upgrade notes:**

- `renderToSchemaV2()`, `introspect()` with render options, and `askdb introspect --out` throw when `schema.json` in the output directory is a symbolic link. Replace the link with a regular file.
- Writing `schema.json` now needs write access to the output directory for the temp file, and a hard link at `schema.json` is replaced instead of written through. On Windows, the rename fails with `EPERM` while another process holds `schema.json` open; running again usually works.
