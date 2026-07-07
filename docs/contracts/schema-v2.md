# AskDB Schema v2 — describable schema artifact (contract)

This document is the **format contract** for AskDB's describable-schema layer. It defines:

1. **On-disk layout** — what files exist and where.
2. **Field semantics** — the structured front-matter fields and their meanings.
3. **Stable identifiers** — the `id` scheme that survives re-introspection and re-embedding.
4. **Chunking rules** — how `@askdb/rag` slices the artifact for embedding and retrieval.
5. **Sensitive propagation** — how the `sensitive` flag flows from the physical layer into prompts and chunks.
6. **Versioning** — how Schema v2 evolves pre-1.0 and how a future v3 would land.

Schema v2 is the **only** schema format AskDB understands once Phase 5 lands. Pre-1.0 we are not maintaining a backward-compat path to any earlier internal format; the `version` literal in `schema.json` stays `2` as a stable marker.

---

## On-disk layout

A v2 schema is a **directory**, not a single file. One directory per `schemaId`:

```text
my-app.schema/
  schema.json                # physical layer (JSON with stable IDs)
  tables/
    users.md                 # describable layer (front-matter + markdown body)
    orders.md
    order_items.md
  concepts.md                # optional cross-table vocabulary
  schema.lock.json           # optional, machine-managed pointer to last embedded checksums
```

| File | Required | Owner | Source of truth for |
|---|---|---|---|
| `schema.json` | yes | introspection / human | physical structure (tables, columns, types, FKs, `sensitive`) |
| `tables/<table>.md` | optional, one per described table | Studio / web catalog / human | descriptions, business context, aliases, common query language, examples |
| `concepts.md` | optional | Studio / human | cross-table vocabulary (e.g. *customer* → users + leads) |
| `schema.lock.json` | optional | `@askdb/rag` | embedding checksums per chunk id |

A v2 directory with `schema.json` and zero `tables/*.md` files is valid — `@askdb/core` loads it with an empty describable layer (no descriptions, no aliases, no concepts). Authoring the describable layer is opt-in per table.

### Bundled distribution

For consumers that want a single artifact to ship, `askdb bundle` (Phase 7) compiles a directory into one packed JSON:

```text
my-app.schema.bundle.json
```

The bundle preserves all field semantics and IDs; it is read-only — authoring still happens against the directory.

---

## Physical layer — `schema.json`

The physical layer is JSON with stable IDs and relationships. The current `version` literal is `2`:

```jsonc
{
  "version": 2,
  "schemaId": "orders-users",
  "tables": [
    {
      "id": "table:public.users",
      "name": "users",
      "schema": "public",
      "sensitive": false,
      "columns": [
        {
          "id": "table:public.users#id",
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "primaryKey": true,
          "sensitive": false
        },
        {
          "id": "table:public.users#email",
          "name": "email",
          "type": "text",
          "nullable": false,
          "sensitive": true
        }
      ],
      "relationships": [
        { "from": "table:public.orders#user_id", "to": "table:public.users#id" }
      ]
    }
  ]
}
```

Required table fields are `id`, `name`, `schema`, and `columns`. Required column fields are `id`, `name`, `type`, and `nullable`. `primaryKey`, `sensitive`, and `relationships` are optional at the schema level, though AskDB's generated artifacts currently emit `sensitive: false` for tables and columns so the physical layer remains explicit.

### Stable ID scheme

| Entity | ID format | Example |
|---|---|---|
| Schema | the `schemaId` string | `orders-users` |
| Table | `table:<schema>.<table_name>` | `table:public.users` |
| Column | `table:<schema>.<table_name>#<column_name>` | `table:public.users#email` |
| Concept | `concept:<slug>` | `concept:customer` |
| Relationship | `<from-id>-><to-id>` (derived chunk id; relationships are authored as `{ from, to }`) | `table:public.orders#user_id->table:public.users#id` |

**Rules:**

- IDs preserve the connector's physical identifier casing. Postgres introspection usually emits lowercase identifiers because unquoted Postgres names are folded to lowercase; Prisma schema introspection can emit mixed-case names such as `table:public.Order#userId` when those are the physical/model identifiers AskDB is describing.
- The database schema/namespace is always included in table and column IDs, including `public`: `table:public.users`. The `schema` table field stores the namespace separately for prompt formatting.
- Multi-schema tables are addressed with the dot between namespace and table name. The `#` separator is reserved for column suffixes.
- IDs **must not change** when the same logical entity is re-introspected; renaming a table or column is a **breaking change** and requires re-embedding.
- IDs are the **only** cross-reference mechanism between the physical layer and the describable layer. Names alone are never used for linking.

---

## Describable layer — `tables/<table>.md`

One file per described table. Format: **YAML front-matter** for structured fields, **markdown body** for prose.

```markdown
---
id: table:public.orders
name: orders
schemaId: orders-users
primaryEntity: order
aliases: [purchases, sales, transactions]
tags: [revenue, transactional]
sensitive: false
columns:
  - id: table:public.orders#id
    aliases: [order_id]
  - id: table:public.orders#status
    aliases: [order_status]
    enum: [pending, paid, shipped, cancelled]
    description: Order lifecycle state. Most reporting filters on `paid`.
  - id: table:public.orders#total_amount
    aliases: [revenue, sale_amount]
    description: Stored in USD. Pre-discount totals live in `order_items`.
---

# Table: orders

Customer purchase orders. One row per submitted order.

## Common query language

- "sales" usually means paid orders (`status = 'paid'`)
- "revenue" usually means `sum(total_amount)` where `status = 'paid'`
- "new orders" usually means orders created in the selected date range

## Example questions

- How much revenue did we make last month?
- Which customers placed the most orders?
- How many orders were cancelled this week?

## Business context

Orders move through `pending → paid → shipped` and may end in `cancelled`. Refunds are not tracked here; see `refunds`.
```

### Front-matter schema

The front-matter shape is validated by zod (in `@askdb/core`). Cross-reference checks are performed by the loader as warnings, not zod parse failures.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Intended to equal a `table:*` id from `schema.json`. Unknown table IDs are reported as loader warnings and are ignored by normalization/chunking. |
| `name` | string | yes | Human-friendly table name (often equals the SQL name). |
| `schemaId` | string | yes | Intended to match the parent `schema.json`'s `schemaId`. Current zod validation only requires a non-empty string; the loader does not enforce equality. |
| `primaryEntity` | string | no | Slug of the concept this table primarily represents (e.g. `order`). |
| `aliases` | string[] | no | Alternate phrases users say for this table. |
| `tags` | string[] | no | Free-form labels (`pii`, `revenue`, `internal-only`). |
| `sensitive` | boolean | no | Accepted by the front-matter parser, but the current loader does not apply it. Effective sensitivity comes from `schema.json` only. |
| `tracked` | boolean | no | Defaults to `true`. Set `false` to keep the table in the schema artifact but exclude it from full-schema NL→SQL prompt DDL and RAG indexing. |
| `toIgnore` / `to-ignore` | boolean | no | Authoring aliases for table exclusion. `true` is normalized to `tracked: false`; writers persist the canonical `tracked` field. |
| `columns` | array | no | Per-column overrides and additions. Items keyed by `id`. |
| `columns[].id` | string | yes (in array) | Intended to equal a `table:*#*` id from `schema.json`. Unknown column IDs are reported as loader warnings and are ignored by normalization/chunking. |
| `columns[].aliases` | string[] | no | Alternate names for this column. |
| `columns[].enum` | string[] | no | Known value set, used in prompts and "common query language" chunks. |
| `columns[].description` | string | no | One- or two-sentence description. Goes into the column chunk. |
| `columns[].sensitive` | boolean | no | Accepted by the front-matter parser, but the current loader does not apply it. Effective sensitivity comes from `schema.json` only. |

Front-matter must be **complete enough to validate** — unknown keys are an error (caught early so typos don't silently disappear). Use markdown body for anything not modeled. Cross-reference mismatches are non-fatal so re-introspection can surface orphaned describable metadata and authoring tools can offer a prune flow instead of refusing to load.

### Markdown body — recognized H2 sections

Authoring surfaces and the chunker recognize these H2 headings (case-insensitive). Other H2s are stored as freeform body text:

| H2 | Used by chunker as | Notes |
|---|---|---|
| `Common query language` | high-priority retrieval text (alias-style mappings) | The single highest-value section for grounding NL→SQL. |
| `Example questions` | retrieval text (intent matching) | Each `- ` item becomes a sub-chunk for question-style retrieval. |
| `Business context` | retrieval text (background) | Long-form context. |
| `Column notes` | per-column appendix | Bulleted items keyed by `` `column_name` `` extend the column chunk. |

The **first paragraph** under `# Table: <name>` is the table's primary description — used in prompts even when no other H2 is present.

---

## Optional concepts — `concepts.md`

Cross-table vocabulary for cases where one domain term resolves across multiple tables (e.g. *customer* lives in both `users` and `leads`):

```markdown
---
concepts:
  - id: concept:customer
    label: Customer
    synonyms: [user, client, buyer, account holder]
    links: [table:public.users, table:public.leads]
    description: A person who has either signed up or expressed intent to purchase.
  - id: concept:revenue
    label: Revenue
    synonyms: [sales, gross sales, top line]
    links: [table:public.orders#total_amount]
    description: Sum of `orders.total_amount` where `status = 'paid'`.
---

# Concepts

Brief prose section if humans want to elaborate.
```

Concepts produce their own chunks at retrieval time (see [Chunking rules](#chunking-rules)).

---

## Chunking rules

`@askdb/rag` derives chunks deterministically from the v2 artifact. Each chunk has a stable `id` and a derived **chunk text** that is what gets embedded.

| Chunk type | `id` | Chunk text contains |
|---|---|---|
| **Table** | `chunk:<table-id>` | `# <schema>.<name>` + first paragraph + aliases + primary entity + relationship IDs + column **headlines** (`name type (flags) — description`). |
| **Column** | `chunk:<column-id>` | qualified column name + type + flags + physical id + description + aliases + enum values + any matching `Column notes` line. |
| **Common query language** | `chunk:<table-id>#cql` | the H2 body verbatim, prefixed with the table name + aliases so retrieval has table context. Long CQL bodies use `#bc:<n>` suffixes. |
| **Example question** | `chunk:<table-id>#q:<n>` | one bullet from `Example questions`, prefixed with the table name + primary entity. |
| **Business context** | `chunk:<table-id>#biz` | the `Business context` H2 body, prefixed with the table name. Long bodies use `#bc:<n>` suffixes, e.g. `chunk:table:public.orders#biz#bc:1`. |
| **Concept** | `chunk:<concept-id>` | label + synonyms + link IDs + description when the concept is included. |
| **Relationship** (optional) | `chunk:<from-id>-><to-id>` | natural-language summary: `Relationship: <from-table>.<from-col> references <to-table>.<to-col>`. |

### Determinism

Given the same v2 artifact, the chunker must produce the **same chunk ids and the same chunk texts** on every run. Re-embedding only happens when chunk text changes (tracked via `schema.lock.json`).

### Size guidance

- Current chunk splitting uses a character ceiling, not a tokenizer. The default ceiling is 1000 characters.
- Long `Common query language` and `Business context` bodies get split on paragraph boundaries with suffix `#bc:1`, `#bc:2`, etc.
- Table chunks include column **headlines** but not full descriptions, so retrieval can fan out to column chunks for detail.

---

## Sensitive propagation

The `sensitive` flag must flow consistently from the physical layer through prompts and chunks. Behavior matches today's [`sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) defaults extended for v2:

| Surface | Default behavior for sensitive table/column | Override |
|---|---|---|
| **NL→SQL DDL** (in core prompt) | Identifier listed, tagged `(sensitive)` — model can ground SQL. | `omitSensitiveIdentifiersFromNlToSqlPrompt` strips identifiers entirely (existing flag). |
| **Describable layer chunks (table/column)** | Sensitive table chunks and sensitive column chunks are excluded entirely. Non-sensitive table chunks omit sensitive columns from their column headline list and refs. | `@askdb/rag` option `includeSensitiveDescribable: true` (off by default). |
| **`Common query language` chunk** | If the H2 body **mentions** a sensitive column by name, the chunk is **excluded entirely**. The chunker does not partial-redact prose. | Same option as above. |
| **Example question / `Business context` chunks** | If the table is sensitive or the source text mentions a sensitive column by name, the affected chunks are excluded entirely. | Same option as above. |
| **Concept chunks** | Concepts that **link to** a sensitive id, or whose description mentions a sensitive column by name, are excluded entirely by default. | Same option as above. |
| **Logs** | Counts only — `askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`. Never log identifiers or values. | n/a |

**Authoring rule (authoring surfaces):** when a user adds a description that mentions a sensitive column by name, the authoring surface shows a non-blocking warning explaining the chunk-exclusion behavior. The user can still save; the chunker will exclude the resulting chunk.

**Bundling rule:** the `bundle` step preserves sensitive flags faithfully; the bundled JSON does not mask anything that the directory format does not also mask. Filtering happens at chunk time, not at bundle time.

---

## Versioning

Schema v2 is the only format AskDB reads. Pre-1.0, v2 may evolve **in place** — additive fields can land without a version bump, and breaking field changes require a contract-doc revision (this file) plus a coordinated release across `@askdb/core`, `@askdb/introspect`, `@askdb/enrich`, and `@askdb/rag`. Post-1.0, any breaking change requires a `version: 3` bump and a new contract document at `docs/contracts/schema-v3.md`.

Re-introspection and on-disk evolution behavior:

| Scenario | Behavior |
|---|---|
| v2 directory with **only** `schema.json` (no `tables/*.md`) | Loaded with an empty describable layer; every table falls back to physical names + types. |
| v2 directory with `tables/*.md` for **some** tables | Described tables benefit; un-described tables fall back to physical names + types. |
| Adding a new column via re-introspection | `schema.json` updates with a fresh column id; matching `tables/<table>.md` is **not** auto-edited; `@askdb/enrich`-backed authoring surfaces show the new column as un-described on next open; chunker emits a chunk for the new column with no description. |
| Removing a column | `schema.json` drops the column id; `@askdb/enrich` flags any now-orphaned `columns[].id` in front-matter and authoring surfaces can offer a one-shot prune. Chunker drops the dead chunk. |
| Renaming a column | Treated as remove + add (IDs are not auto-mapped). User confirms in an authoring surface; embeddings re-fire. |

---

## Implementation locus

| Concern | Package |
|---|---|
| Parser, validator, normalizer, prompt assembly | `@askdb/core` |
| Schema introspection (catalog → physical layer + stable id assignment) | `@askdb/introspect` |
| Headless authoring workflow (read/write `tables/*.md`, `concepts.md`, drafts, markdown-section updates, bundling, suggestion target/context helpers) | `@askdb/enrich` |
| Local browser authoring surface | `@askdb/studio`, built on `@askdb/enrich` |
| Chunker, sensitive propagation, lock file | `@askdb/rag` |

---

## References

- [`docs/mission.md`](../mission.md) — describable schema, RAG-friendly format
- [`docs/platform.md`](../platform.md) — package layout, BYO seams
- [`docs/adrs/0004-enrichment-package-boundary.md`](../adrs/0004-enrichment-package-boundary.md) — shared enrichment package boundary
- [`docs/contracts/sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) — sensitive identifier rules in NL→SQL prompts
- [`packages/core/src/schema/v2/physical.ts`](../../packages/core/src/schema/v2/physical.ts) — physical `schema.json` zod shape
- [`packages/core/src/schema/v2/describable.ts`](../../packages/core/src/schema/v2/describable.ts) — describable front-matter zod shapes
- [`packages/core/src/schema/v2/loader.ts`](../../packages/core/src/schema/v2/loader.ts) — v2 loader, normalizer, and orphan warning behavior
- [`packages/core/src/schema/v2/format.ts`](../../packages/core/src/schema/v2/format.ts) — NL→SQL prompt formatting for normalized v2 schemas
- [`packages/introspect/src/render/render.ts`](../../packages/introspect/src/render/render.ts) — introspection renderer and stable physical ID assignment
- [`packages/enrich/src/workspace.ts`](../../packages/enrich/src/workspace.ts) — authoring workspace, pruning, and bundling
- [`packages/rag/src/chunker/chunker.ts`](../../packages/rag/src/chunker/chunker.ts) — chunk IDs, chunk text, and sensitive propagation
- [`packages/rag/src/indexer/lock-file.ts`](../../packages/rag/src/indexer/lock-file.ts) — `schema.lock.json` shape
