---
"@askdb/core": minor
"@askdb/enrich": patch
"@askdb/docs-site": patch
---

- **A wrong-case schema file name throws instead of being skipped.** `loadSchema()` now throws `SchemaParseError` when a schema directory holds `Tenant-Policy.md`, `Concepts.md`, `Tables/`, `tables/<name>.MD`, or (for a directory path) `Schema.json`. The error names each rename, for example `rename Tenant-Policy.md to tenant-policy.md`. Before, on Linux (case-sensitive), the loader skipped those files: a skipped `tenant-policy.md` loaded the schema with no tenant policy, so `ask()` stopped requiring a `tenantScope`, and nothing reported an error. A `tables/*.MD` file was skipped on every OS, with every `sensitive: true` in it. The check runs on every OS, so a directory that loaded on macOS or Windows with a wrong-case name now throws there too. Rename the file to fix it. A path you pass is still read as given, so `loadSchema("<dir>/Schema.json")` loads as before. See ADR 0027.
- **An optional file is absent only when the directory doesn't list it.** A listed `tenant-policy.md`, `concepts.md`, `tables/` or table file that can't be read now throws, including a symbolic link whose target is missing, which used to load as "no file".
- **The stray-JSON check counts a sibling in any case.** On Linux, `loadSchema("<dir>/prod-schema.json")` beside `Tenant-Policy.md` loaded with no tenant policy. It now throws, as it already did beside `tenant-policy.md` (ADR 0019).
- **New `readSchemaDirectory(dir)`** in `@askdb/core` reads a schema directory into its `BundledSchemaV2` bundle form. `loadSchema()` reads every directory through it.
- **`@askdb/enrich`'s `bundleSchemaDirectory()` returns `readSchemaDirectory()`**, so `askdb bundle` refuses the same directories `loadSchema()` refuses, instead of writing a bundle without a wrong-case `Tenant-Policy.md`. Its errors are now `SchemaParseError`s from core.
- Docs: the core API reference covers `readSchemaDirectory()` and the exact-name rule; troubleshooting covers the new error; the CLI reference notes that `askdb bundle` refuses such a directory.
