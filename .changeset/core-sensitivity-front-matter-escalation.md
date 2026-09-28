---
"@askdb/core": minor
"@askdb/studio": patch
"@askdb/enrich": patch
---

**@askdb/core**: `loadSchema()` and `loadSchemaFromJson()` now apply `sensitive: true` from table markdown front-matter (`tables/*.md`), at both the table and the `columns[]` level, on top of `schema.json`. Before, front-matter `sensitive` was parsed but ignored. Studio's Sensitivity tab writes front-matter, so a column marked Sensitive there was still treated as non-sensitive by the NL→SQL prompt (tagging and `omitSensitiveIdentifiersFromNlToSqlPrompt`), by `@askdb/rag` chunk exclusion, and by `validateSensitiveReferences`.

The rule is escalate-only. Front-matter can make a table or column sensitive but can never make one less sensitive. A front-matter `sensitive: false` on a table or column that is sensitive anyway (from `schema.json`; for a column, also from a sensitive table or another front-matter entry's `sensitive: true`) is ignored and reported in `NormalizedSchemaV2.warnings` as the new `{ kind: "sensitivity_downgrade_ignored", tableFile, id }` warning. Directory and bundle loads behave the same way.

A front-matter column ID is authoritative about which column it names. If a `columns[]` entry lists a column that belongs to a different table (for example `table:public.users#ssn` in `tables/orders.md`), its `sensitive: true` still escalates that column (dropping it would silently expose a column the author marked sensitive), and the loader reports the new `{ kind: "misplaced_column_id", tableFile, id, tableId }` warning, where `tableId` is the owning table. Nothing else in a misplaced entry is applied: `sensitive: false` never de-escalates, and its description, aliases, and enum are ignored.

A column may be named by more than one `columns[]` entry, repeated in one file or across files. Sensitivity is aggregated across all of them: the column is sensitive if any entry says `sensitive: true`, and no entry's `sensitive: false` cancels it. Each repeat of an ID within one file is reported as the new `{ kind: "duplicate_column_id", tableFile, id }` warning, and only the first entry's description, aliases, and enum are applied.

Two table markdown files whose front-matter has the same `id` are now a load error (`SchemaParseError` naming both files) for directory and bundle loads. Before, the loader silently kept whichever file it read last (which depended on filesystem order) and dropped the other's front-matter, including any `sensitive: true`, while Studio could pair the table with the other file. Table markdown files are now read in sorted filename order, so warning order is deterministic and identical for directory and bundle loads.

The `tableFile` in loader warnings (`orphaned_table_id`, `orphaned_column_id`, `sensitivity_downgrade_ignored`, `misplaced_column_id`, `duplicate_column_id`) is now the table markdown file actually read (`tables/<filename>`, or the bundle's `tables` entry key). Before, it was derived from front-matter `name`, which is wrong when the filename differs (for example `tables/customer-records.md` with `name: users`).

This is a behavior change: schemas whose front-matter already sets `sensitive: true` will now have more sensitive tables and columns. Those tables and columns lose their describable fields in the normalized schema, are tagged or omitted in prompts, are excluded from RAG chunks by default, and are flagged by the sensitive-SQL guardrail. Code that switches exhaustively over `SchemaV2Warning["kind"]` needs to handle the three new kinds.

**@askdb/studio**: the Sensitivity tab's "Effective" column now matches the loader. It accounts for table-level sensitivity, and "Not sensitive" is disabled where it could not take effect, on both the Sensitivity and Enrichment tabs. The Enrichment tab's column "sensitive" badge also reflects table-level sensitivity.

Studio also accounts for a column escalated from another table's markdown (shown as sensitive, with "Not sensitive" disabled), and saving a table no longer deletes `columns[]` entries for other tables' columns from its file.

**@askdb/enrich**: `buildTableDraft()` marks a column sensitive when any of its front-matter entries says `sensitive: true`, not just the first. Before, a file listing a column twice (first `sensitive: false` or unset, then `sensitive: true`) produced a non-sensitive draft, so saving it in Studio rewrote the file without the escalation. `buildFrontmatter()` takes an optional fourth argument, the file's `existing` front-matter: its `columns[]` entries for IDs that are not the table's own columns (misplaced or orphaned) are carried through unchanged, so rewriting a file no longer silently drops another table's `sensitive: true`. `WorkspaceTable` has a new optional `escalatedByOtherFiles` field (set by `loadWorkspace()`) listing the table's columns that another table's markdown marks `sensitive: true`. `loadWorkspace()` now throws when two table markdown files share a front-matter `id` (it calls `loadSchema()`).
