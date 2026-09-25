---
"@askdb/enrich": patch
---

Include `tenant-policy.md` in schema bundles, and make table markdown filenames collision-safe and confined to `tables/`.

- `bundleSchemaDirectory()` (used by `askdb bundle`) now writes the raw `tenant-policy.md` content as `tenantPolicy`. Before this fix, bundles left the policy out, so a multi-tenant schema loaded from a bundle came up with no tenant policy, and `ask()` stopped requiring a `tenantScope` or injecting tenant predicates. Rebuild any bundle made from a directory that has a `tenant-policy.md`. `loadSchema(bundle)` now equals `loadSchema(directory)`.
- `loadWorkspace()` picks default filenames for tables that don't have a markdown file yet. It uses `<schema>.<table>.md` when two tables share a bare name (for example `public.orders` and `archive.orders`, compared case-insensitively), so saving one no longer overwrites the other. It never reuses a filename that's already on disk. Existing files keep their names because they're matched by front-matter `id`.
- Default filenames are made filename-safe: path separators, NUL, control characters, and Windows-reserved characters become `_`, and leading dots get a `_` prefix. `saveTable()` also refuses any filename that would resolve outside `tables/`, so a table named like `../../x` can no longer write outside the schema directory.
