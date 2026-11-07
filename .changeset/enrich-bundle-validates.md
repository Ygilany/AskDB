---
"@askdb/enrich": minor
---

`bundleSchemaDirectory()` checks the bundle it reads with `@askdb/core`'s loader, and throws the loader's `SchemaParseError` for a directory `loadSchema()` refuses, where it returned a bundle that didn't load (#796). That covers front-matter that isn't YAML, a tenant policy that doesn't parse or doesn't fit `schema.json`, and two table files with the same `id`. The error names the file on disk. A bundle it returns always loads.
