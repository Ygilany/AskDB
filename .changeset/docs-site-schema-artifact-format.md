---
"@askdb/docs-site": patch
---

New Schema artifact format reference (`reference/schema-artifact-format`), the first page under Reference → Formats and rules (#713). It covers every file in a schema artifact, every `schema.json` field, every table and concept front-matter key, the stable IDs each engine writes, the sensitivity rules, the 5 warnings `loadSchema()` reports, and the bundle format. It adds facts the site didn't have: `primaryEntity`, `tags`, `tracked` and `toIgnore`, the `concepts.md` format, which body sections reach the prompt and which only `@askdb/rag`, and that front-matter must be YAML since `@askdb/core` 1.0.0-beta.48. The schema artifact page is now an explanation, and links to GHSA-qqx9-qpw2-wcqg. Author your schema has the steps after a rename. The CLI reference no longer says `askdb bundle` refuses every directory `loadSchema()` refuses: it doesn't parse the markdown files.
