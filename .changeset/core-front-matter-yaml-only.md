---
"@askdb/core": patch
---

Schema markdown front-matter accepts YAML only. A `tables/*.md`, `concepts.md` or `tenant-policy.md` file whose front-matter isn't YAML fails to load with `SchemaParseError` (`Malformed <kind> front-matter YAML`). Front-matter that opens with a plain `---`, as Studio and `@askdb/enrich` write it, loads as before.
