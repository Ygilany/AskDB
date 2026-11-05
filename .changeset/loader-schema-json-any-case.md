---
"@askdb/core": minor
"@askdb/docs-site": patch
---

- **`loadSchema("<dir>/Schema.json")` keeps the tenant policy.** The `schema.json` file name now matches in any case. Before, on macOS and Windows (case-insensitive by default), `Schema.json` or `SCHEMA.JSON` opened the same file but loaded it as a standalone physical layer: the sibling `tenant-policy.md` was dropped, so `ask()` stopped requiring a `tenantScope`, and nothing reported an error. It now loads the enclosing directory, like `loadSchema("<dir>/schema.json")`, reading the physical layer from the path you gave.
- **A JSON file inside a schema directory must be `schema.json`.** Any other JSON file that isn't a bundle now throws `SchemaParseError` when `tenant-policy.md`, `tables/` or `concepts.md` sits beside it, instead of loading without them. A copy such as `prod-schema.json` used to load without its tenant policy and without the `sensitive: true` marks in `tables/*.md`. Pass the directory, rename the file to `schema.json`, or pass its content to `loadSchemaFromJson()` to load only the physical layer. A JSON file with none of those files beside it still loads as a standalone physical layer. See ADR 0019.
- **Bundle errors name the bundle.** A malformed `tenantPolicy`, `concepts` or `tables` entry in a bundle now throws `SchemaParseError` naming the file and the bundle, for example `tenant-policy.md (in /srv/prod.bundle.json)`, instead of a `tenant-policy.md` that isn't on disk.
- Docs: the core API reference and troubleshooting cover the case-insensitive `schema.json` match, the new error and bundle error names.
