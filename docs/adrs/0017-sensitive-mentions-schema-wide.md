# ADR 0017 — Sensitive-column mentions are matched schema-wide, and table-inherited columns only when qualified

## Status

Accepted (2026-10-04, maintainer decision on #193's review). The rule is in `collectSensitiveNames` (`packages/rag/src/chunker/chunker.ts`), qualified names are matched by `findMentionedNames` (`packages/core/src/schema/v2/mentions.ts`, the mention rule rag and enrich share since #193), and the column provenance it needs is `NormalizedV2Column.sensitiveFromTable`, set by `loadSchema()` and `loadSchemaFromJson()` (`packages/core/src/schema/v2/loader.ts`). Contract: [`schema-v2.md` → Sensitive propagation](../contracts/schema-v2.md#sensitive-propagation).

## Context

`@askdb/rag` keeps describable text out of the index when it mentions a sensitive column by name (whole word, case-insensitive). Two rules decided which names counted, and #193's review found a defect in each:

- **Text that belongs to a table was checked only against that table's sensitive columns.** An `orders` description or common query language body saying "match buyers via users.ssn" was embedded by default with `sensitive: false`. Join guidance, which is where these cross-table mentions appear, went into the index unchecked.
- **Schema-level text (concepts, and tenant policy sections since #193) was checked against every column of every sensitive table, by bare name.** `loadSchema()` makes every column of a sensitive table sensitive, so a sensitive `users(id, org_id, name, …)` table put `id`, `org_id` and `name` on the list. "Always filter orders by org_id" was then dropped from the tenant policy, and a sensitive tenant-root table could drop the whole tenant policy body.

Widening the first rule to the second rule's list would fix the leak and make the over-exclusion worse, so both have to be decided together. Core's SQL check, `validateSensitiveReferences`, has the same problem with table-level `sensitive` and solves it by binding bare names only to tables in scope (see the core API reference, "Scope resolution"). Prose has no `FROM` clause to bind against, so the chunker needs its own way to tell a meaningful mention from a generic name.

The normalized schema didn't record why a column is sensitive: the loader folded "marked itself" and "its table is sensitive" into one `sensitive: true`.

## Decision

- Every piece of describable text is checked against one schema-wide list of names, whichever table or chunk it belongs to: table, column, common query language, example question, business context, concept, and tenant policy text.
- A column marked sensitive itself (in `schema.json`, or by a front-matter `sensitive: true` entry) is on the list by its bare name.
- A column sensitive only because its table is, is on the list only as `table.column`, passed to the matcher as `{ table, column }` rather than a dotted string, so bare names stay literal. How the qualified form matches (quoting, schema prefix, spacing, the table part without its schema) is the contract's mention rule: [`schema-v2.md` → Sensitive propagation](../contracts/schema-v2.md#sensitive-propagation).
- Sensitive columns of untracked tables are on the list too: they are still sensitive data, even though their tables aren't indexed.
- `loadSchema()` and `loadSchemaFromJson()` (directory and bundle loads) record the provenance as `NormalizedV2Column.sensitiveFromTable: true`, set only on columns that are sensitive solely through their table. Normalized schemas built some other way, without the field, are treated as if every sensitive column were marked itself (bare names: the conservative reading).

## Options considered

- **Keep per-table scope for table text, document the gap.** Rejected: cross-table join guidance is a normal place to name another table's sensitive column, and the per-table rule embeds it unchecked by default.
- **Schema-wide bare names for everything, including table-inherited columns.** Rejected: generic column names of a sensitive table (`id`, `org_id`, `created_at`) would exclude most concepts and tenant policy text in schemas with a sensitive tenant-root or user table.
- **Bare names only when no non-sensitive column in the schema shares the name.** Rejected: it needs no core change, but it would stop a column marked sensitive itself (`users.email`) from matching by bare name as soon as another table has a non-sensitive `email`. Whether a column was marked sensitive is the author's statement; a name collision elsewhere shouldn't weaken it.
- **Leave table-inherited columns off the list entirely.** Rejected: a qualified mention such as `users.org_id` is unambiguous and should still count.
- **Infer provenance in `@askdb/rag` from the table markdown.** Rejected: the chunker doesn't see `schema.json`'s column flags, and the loader is the one place that resolves sensitivity (escalate-only, misplaced and repeated front-matter entries). Provenance belongs next to that resolution.

## Consequences

- A column marked sensitive itself with a generic name (for example a PII `users.name`) now excludes every table's text that says "name", not only `users`' own text. That over-exclusion is the cost of catching cross-table mentions, and there is no per-column way to opt a name out.
- A mention of a table-inherited column by its bare name in another table's text ("dedupe by org_id" in `orders`) is embedded. It names an identifier, not data, and the column's own describable layer is still excluded.
- Upgrading changes which chunks are excluded for some schemas, so their content hashes change and an index re-embeds those chunks on the next run.
- `@askdb/enrich`'s authoring warning still checks only a table's own physical-layer sensitive columns, so it no longer predicts every exclusion; aligning it is tracked in #453.
