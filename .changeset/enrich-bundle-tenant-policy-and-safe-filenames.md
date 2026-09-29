---
"@askdb/enrich": patch
---

Include `tenant-policy.md` in schema bundles, and make table markdown filenames collision-safe and confined to `tables/`.

- `bundleSchemaDirectory()` (used by `askdb bundle`) now writes the raw `tenant-policy.md` content as `tenantPolicy`. Before this fix, bundles left the policy out, so a multi-tenant schema loaded from a bundle came up with no tenant policy, and `ask()` stopped requiring a `tenantScope` or injecting tenant predicates. Rebuild any bundle made from a directory that has a `tenant-policy.md`. `loadSchema(bundle)` now equals `loadSchema(directory)`.
- `bundleSchemaDirectory()` returns `BundledSchemaV2` from `@askdb/core`, which owns the bundle format. `BundledSchemaV2` from `@askdb/enrich` is now a deprecated alias of it; import it from `@askdb/core` instead.
- `loadWorkspace()` picks default filenames for tables that don't have a markdown file yet (ADR 0013). It uses `<schema>.<table>.md` when two tables share a bare name (for example `public.orders` and `archive.orders`), so saving one no longer overwrites the other. Names count as shared when a case-insensitive file system would store them as one file: case, Unicode normalization (NFC and NFD `café`) and full case folding (`straße`, `STRASSE` and `STRAẞE`) are ignored. It never reuses a name that's already in `tables/`, whatever its extension. Existing files keep their names because they're matched by front-matter `id`.
- Default filenames are made filename-safe: path separators, NUL, control characters, and Windows-reserved characters become `_`, and leading dots get a `_` prefix. A name longer than 200 bytes, which SQL Server's 128-character identifiers can produce, is shortened and ends in `~` plus an 8-character hash instead of failing with `ENAMETOOLONG`.
- `saveTable()` refuses any filename that would resolve outside `tables/`, so a table named like `../../x` can no longer write outside the schema directory. It also refuses to write when `tables/` or the target file is a symbolic link, and it writes through a temp file renamed over the target, so a hard link planted in `tables/` is replaced instead of written through. Saves are now atomic.
