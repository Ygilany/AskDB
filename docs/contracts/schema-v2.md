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
| `tables/<table>.md` | optional, one per described table | TUI / web catalog / human | descriptions, business context, aliases, common query language, examples |
| `concepts.md` | optional | TUI / human | cross-table vocabulary (e.g. *customer* → users + leads) |
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
      "id": "table:users",
      "name": "users",
      "sensitive": false,
      "columns": [
        {
          "id": "table:users#id",
          "name": "id",
          "type": "uuid",
          "nullable": false,
          "primaryKey": true,
          "sensitive": false
        },
        {
          "id": "table:users#email",
          "name": "email",
          "type": "text",
          "nullable": false,
          "sensitive": true
        }
      ],
      "relationships": [
        { "from": "table:orders#user_id", "to": "table:users#id" }
      ]
    }
  ]
}
```

### Stable ID scheme

| Entity | ID format | Example |
|---|---|---|
| Schema | the `schemaId` string | `orders-users` |
| Table | `table:<table_name>` | `table:users` |
| Column | `table:<table_name>#<column_name>` | `table:users#email` |
| Concept | `concept:<slug>` | `concept:customer` |
| Relationship | `<from-id>→<to-id>` (derived; not authored) | `table:orders#user_id→table:users#id` |

**Rules:**

- IDs are **lowercase**; column/table names are kept verbatim from the database.
- Multi-schema Postgres tables are addressed with a dot inside the table name: `table:public.users`. The `#` separator is reserved for column suffixes.
- IDs **must not change** when the same logical entity is re-introspected; renaming a table or column is a **breaking change** and requires re-embedding.
- IDs are the **only** cross-reference mechanism between the physical layer and the describable layer. Names alone are never used for linking.

---

## Describable layer — `tables/<table>.md`

One file per described table. Format: **YAML front-matter** for structured fields, **markdown body** for prose.

```markdown
---
id: table:orders
name: orders
schemaId: orders-users
primaryEntity: order
aliases: [purchases, sales, transactions]
tags: [revenue, transactional]
sensitive: false
columns:
  - id: table:orders#id
    aliases: [order_id]
  - id: table:orders#status
    aliases: [order_status]
    enum: [pending, paid, shipped, cancelled]
    description: Order lifecycle state. Most reporting filters on `paid`.
  - id: table:orders#total_amount
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

Validated by zod (in `@askdb/core`):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Must equal a `table:*` id from `schema.json`. |
| `name` | string | yes | Human-friendly table name (often equals the SQL name). |
| `schemaId` | string | yes | Must match the parent `schema.json`'s `schemaId`. |
| `primaryEntity` | string | no | Slug of the concept this table primarily represents (e.g. `order`). |
| `aliases` | string[] | no | Alternate phrases users say for this table. |
| `tags` | string[] | no | Free-form labels (`pii`, `revenue`, `internal-only`). |
| `sensitive` | boolean | no | Override `schema.json`'s table-level sensitive flag (front-matter wins for describable-layer behavior; physical sensitive flag is independent). |
| `columns` | array | no | Per-column overrides and additions. Items keyed by `id`. |
| `columns[].id` | string | yes (in array) | Must equal a `table:*#*` id from `schema.json`. |
| `columns[].aliases` | string[] | no | Alternate names for this column. |
| `columns[].enum` | string[] | no | Known value set, used in prompts and "common query language" chunks. |
| `columns[].description` | string | no | One- or two-sentence description. Goes into the column chunk. |
| `columns[].sensitive` | boolean | no | Override; same rule as table-level. |

Front-matter must be **complete enough to validate** — unknown keys are an error (caught early so typos don't silently disappear). Use markdown body for anything not modeled.

### Markdown body — recognized H2 sections

The TUI and chunker recognize these H2 headings (case-insensitive). Other H2s are stored as freeform body text:

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
    links: [table:users, table:leads]
    description: A person who has either signed up or expressed intent to purchase.
  - id: concept:revenue
    label: Revenue
    synonyms: [sales, gross sales, top line]
    links: [table:orders#total_amount]
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
| **Table** | `chunk:table:<name>` | `# <name>` + first paragraph + `aliases` joined inline + relationship summary + column **headlines** (`name: type — description`). |
| **Column** | `chunk:table:<name>#<col>` | qualified column id + type + flags + description + aliases + enum values + any matching `Column notes` line. |
| **Common query language** | `chunk:table:<name>#cql` | the H2 body verbatim, prefixed with the table name + aliases so retrieval has table context. |
| **Example question** | `chunk:table:<name>#q:<n>` | one bullet from `Example questions`, prefixed with the table name + primary entity. |
| **Concept** | `chunk:<concept-id>` | label + synonyms + linked-id labels + description. |
| **Relationship** (optional) | `chunk:<from-id>→<to-id>` | natural-language summary: "`<from-table>` has many `<to-table>` via `<from-col>`". |

### Determinism

Given the same v2 artifact, the chunker must produce the **same chunk ids and the same chunk texts** on every run. Re-embedding only happens when chunk text changes (tracked via `schema.lock.json`).

### Size guidance (non-normative)

- Target **per-chunk token count**: 60–250 tokens. Long bodies (`Business context` over ~300 tokens) get split on paragraph boundaries with suffix `#bc:1`, `#bc:2`, etc.
- Table chunks include column **headlines** but not full descriptions, so retrieval can fan out to column chunks for detail.

---

## Sensitive propagation

The `sensitive` flag must flow consistently from the physical layer through prompts and chunks. Behavior matches today's [`sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) defaults extended for v2:

| Surface | Default behavior for sensitive table/column | Override |
|---|---|---|
| **NL→SQL DDL** (in core prompt) | Identifier listed, tagged `(sensitive)` — model can ground SQL. | `omitSensitiveIdentifiersFromNlToSqlPrompt` strips identifiers entirely (existing flag). |
| **Describable layer chunks (table/column)** | Identifier and **type** included; **description, aliases, enum, examples — excluded** from chunk text. | `@askdb/rag` option `includeSensitiveDescribable: true` (off by default). |
| **`Common query language` chunk** | If the H2 body **mentions** a sensitive column by name, the chunk is **excluded entirely**. The chunker does not partial-redact prose. | Same option as above. |
| **Concept chunks** | Concepts that **link to** a sensitive id include the link metadata but exclude any description text that names the sensitive column. | Same option. |
| **Logs** | Counts only — `askdb.rag.sensitive_chunks_excluded`, `askdb.rag.sensitive_chunks_included`. Never log identifiers or values. | n/a |

**Authoring rule (TUI):** when a user adds a description that mentions a sensitive column by name, the TUI shows a non-blocking warning explaining the chunk-exclusion behavior. The user can still save; the chunker will exclude the resulting chunk.

**Bundling rule:** the `bundle` step preserves sensitive flags faithfully; the bundled JSON does not mask anything that the directory format does not also mask. Filtering happens at chunk time, not at bundle time.

---

## Versioning

Schema v2 is the only format AskDB reads. Pre-1.0, v2 may evolve **in place** — additive fields can land without a version bump, and breaking field changes require a contract-doc revision (this file) plus a coordinated release across `@askdb/core`, `@askdb/introspect`, `@askdb/tui`, and `@askdb/rag`. Post-1.0, any breaking change requires a `version: 3` bump and a new contract document at `docs/contracts/schema-v3.md`.

Re-introspection and on-disk evolution behavior:

| Scenario | Behavior |
|---|---|
| v2 directory with **only** `schema.json` (no `tables/*.md`) | Loaded with an empty describable layer; every table falls back to physical names + types. |
| v2 directory with `tables/*.md` for **some** tables | Described tables benefit; un-described tables fall back to physical names + types. |
| Adding a new column via re-introspection | `schema.json` updates with a fresh column id; matching `tables/<table>.md` is **not** auto-edited; the TUI shows the new column as un-described on next open; chunker emits a chunk for the new column with no description. |
| Removing a column | `schema.json` drops the column id; the TUI flags any now-orphaned `columns[].id` in front-matter and offers a one-shot prune. Chunker drops the dead chunk. |
| Renaming a column | Treated as remove + add (IDs are not auto-mapped). User confirms in TUI; embeddings re-fire. |

---

## Implementation locus

| Concern | Package |
|---|---|
| Parser, validator, normalizer, prompt assembly | `@askdb/core` (Phase 5) |
| Schema introspection (catalog → physical layer + stable id assignment) | `@askdb/introspect` (Phase 6) |
| Authoring (read/write `tables/*.md`, `concepts.md`) | `@askdb/tui` (Phase 7) |
| Chunker, sensitive propagation, lock file | `@askdb/rag` (Phase 8) |

---

## References

- [`docs/mission.md`](../mission.md) — describable schema, RAG-friendly format
- [`docs/platform.md`](../platform.md) — package layout, BYO seams
- [`docs/contracts/sensitive-fields-and-modes.md`](./sensitive-fields-and-modes.md) — sensitive identifier rules in NL→SQL prompts
- [`docs/specs/phase-5-schema-v2-core/`](../specs/phase-5-schema-v2-core/) — implementation of v2 reader/writer in `@askdb/core`
- [`docs/specs/phase-6-introspection/`](../specs/phase-6-introspection/) — `@askdb/introspect` connector + two-path semantics
- [`docs/specs/phase-7-tui-enrichment/`](../specs/phase-7-tui-enrichment/) — `@askdb/tui` describable-layer authoring surface
- [`docs/specs/phase-8-rag/`](../specs/phase-8-rag/) — chunker + retriever
