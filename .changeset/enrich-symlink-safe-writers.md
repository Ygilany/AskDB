---
"@askdb/enrich": minor
"@askdb/studio": patch
"@askdb/docs-site": patch
---

`concepts.md` and `tenant-policy.md` saves no longer follow symbolic links (#372).

- `saveConcepts()` now refuses to write when `concepts.md` is a symbolic link, with `Refusing to write concepts.md outside the schema directory: "concepts.md" is a symbolic link`. Before, a link planted at `concepts.md` (git stores symbolic links) made a save write to the file it pointed at, outside the schema directory.
- New `saveTenantPolicy(workspace, frontmatter, body)` saves `tenant-policy.md` the same way. It first checks the policy with the core loader's rules and throws `SchemaParseError`, writing nothing, when `loadSchema()` would reject it.
- `saveTable()`, `saveConcepts()` and `saveTenantPolicy()` share one write path: a symbolic link at the target or at `tables/` is refused, and the content goes to a temp file renamed over the target. So `concepts.md` and `tenant-policy.md` saves are now atomic too, a hard link at either file is replaced instead of written through, and the replaced file keeps its permission bits, group and, where allowed, owner. A read-only file is still refused with `EACCES`. The schema directory itself may be a symbolic link.
- Studio's tenant-policy save (`POST /api/tenant-policy`) calls `saveTenantPolicy()` instead of writing the file itself, so it refuses a symbolic link at `tenant-policy.md` too. A policy that wouldn't load still gets `400`.

**Upgrade notes:**

- A `saveConcepts()` caller whose `concepts.md` is a symbolic link now gets an error. Replace the link with a regular file in the schema directory.
- Saving `concepts.md` or `tenant-policy.md` now needs write access to the schema directory, as saving a table already needs it for `tables/`: the temp file is created there. A writable file in a read-only schema directory now fails with `EACCES` instead of saving in place.
