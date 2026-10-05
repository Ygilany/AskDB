---
"@askdb/core": patch
"@askdb/rag": patch
---

**Sensitive-column mentions are matched schema-wide (ADR 0017).** `@askdb/rag` now checks every table's describable text (table, column, common query language, example question, and business context) against the sensitive columns of the whole schema, not only that table's, so an `orders` note that says "match via users.ssn" is excluded by default. A column that is sensitive only because its table is now counts only when mentioned as `table.column`, so generic names of a sensitive table (`id`, `org_id`) no longer drop unrelated concepts and tenant policy sections. To support this, `loadSchema()` sets `sensitiveFromTable: true` on columns that are sensitive solely through their table, and `findMentionedNames` matches a qualified name with a schema prefix, with each part quoted or bracketed (`"users"."org_id"`, `[users].[org_id]`), and with spaces around a dot. Some schemas will exclude different chunks after upgrading, which re-embeds those chunks on the next index run.
