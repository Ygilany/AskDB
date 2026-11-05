---
"@askdb/core": minor
"@askdb/config": minor
"@askdb/enrich": minor
"@askdb/studio": patch
---

Remove public exports that nothing in AskDB calls and no page documents, before the 1.0 API freeze (#356, ADR 0030).

**Upgrade notes (breaking):**

- `@askdb/core`: `formatSchemaForPrompt(schema, options)` is removed. Call `formatSchemaForNlToSql(schema, options).ddl`, which returns the same string.
- `@askdb/config`: `DEFAULT_LOCAL_POSTGRES_URL` is removed, with no replacement. Write your own local connection string.
- `@askdb/enrich`: `hasAnyColumnDescribable`, `isEnumCandidate`, `parseListInput` and `formatList` are removed, with no replacement. In place of `parseListInput(value)`, use `value.split(",").map((s) => s.trim()).filter(Boolean)`; in place of `formatList(list)`, use `list?.join(", ") ?? ""`.

Internal cleanup with no API change: core's tenant-policy loader drops two unused helpers, and Studio's web app drops the unused `Drawer` and `Panel` components, the Drawer CSS and four unused formatting helpers.
