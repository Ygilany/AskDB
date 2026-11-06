---
"@askdb/core": patch
---

Schema markdown front-matter accepts YAML only. A `tables/*.md`, `concepts.md` or `tenant-policy.md` file whose front-matter isn't YAML fails to load with `SchemaParseError` (`Malformed <kind> front-matter YAML`). Files that AskDB, Studio or `askdb introspect` write are YAML and load as before.
