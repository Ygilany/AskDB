# Feature: Schema Format

**Status:** Complete  
**Packages:** `@askdb/core` (reader, writer, parser, validator, prompt assembly)

## Overview

Schema v2 is the on-disk format for describing a database schema to AskDB. It is a split artifact: a physical layer (`schema.json`) captures table and column structure with stable IDs, and a describable layer (`tables/<table>.md` per table, optional `concepts.md`) captures human-authored business context — descriptions, aliases, common query language, and example questions.

The reader and writer live in `@askdb/core`. The format is designed to be hand-editable in any text editor, round-trippable by the writer, and consumed directly by prompt assembly and the RAG chunker.

**Format contract:** [`docs/contracts/schema-v2.md`](../contracts/schema-v2.md)

## Scope

### In scope

- **Schema v2 loader** — `loadSchema(path)` autodetects between a v2 directory, bundled JSON, or a `schema.json` path inside a directory; returns a unified `NormalizedSchema`
- **Front-matter parser** — zod-based validation; unknown keys are errors; recognized H2 sections (`Common query language`, `Example questions`, `Business context`, `Column notes`) are parsed; body preserved verbatim outside those sections
- **Stable ID enforcement** — every front-matter `id` must match an id in `schema.json`; orphaned ids and missing ids surface as structured warnings
- **Writer** — round-trippable serializer for `tables/<table>.md` and `concepts.md`; round-trip property: `parse(write(parse(file))) === parse(file)` for structured fields; body text preserved verbatim
- **Prompt assembly** — `formatSchemaForNlToSql` reads the describable layer when present: table descriptions, aliases, `Common query language` sections, sensitive propagation
- **Bundle format** — single packed JSON for distribution; read-only (authoring stays in the directory); loader accepts both forms
- **Sensitive propagation** — describable-layer fields excluded for sensitive columns; identifiers tagged `(sensitive)` in DDL output per the contract

### Out of scope

- Interactive authoring — see [`schema-authoring-and-enrichment.md`](./schema-authoring-and-enrichment.md)
- Schema introspection from a live database — see [`introspection.md`](./introspection.md)
- v1 → v2 migration — pre-1.0; the loader rejects pre-v2 format with a clear error pointing at the breaking change
- Multi-language descriptions or i18n
- Collaborative merge — git is the merge story

## Design decisions

- **Split physical + describable** — the physical layer (`schema.json`) is produced by introspection and rewritten on re-introspection; the describable layer (`tables/*.md`) is authored by humans and never touched by introspection. This separation means re-introspection cannot destroy human-authored context.
- **Stable IDs** — every table and column has a stable string ID (`table:<schema>.<name>`, `table:<schema>.<name>#<col>`). Renaming a column in the DB creates a new ID; the old one appears as an orphan warning, preserving the describable layer entry for review.
- **No v1 migrator** — pre-1.0 breaking change. The loader rejects the pre-v2 format with a clear error. Acceptable before 1.0.
- **Unknown front-matter keys are errors** — typos in `tables/*.md` front-matter do not silently disappear; they fail validation so authors notice immediately.
- **YAML front-matter, opaque markdown body** — the writer touches only front-matter; the markdown body (prose, examples) is preserved verbatim. This makes hand-editing safe.

## Contracts and API surface

**Format contract:** [`docs/contracts/schema-v2.md`](../contracts/schema-v2.md)

```ts
// Loader
loadSchema(path: string): Promise<LoadedSchema>

interface LoadedSchema {
  schema: NormalizedSchema
  warnings: SchemaWarning[]
}

// Writer
writeTableMarkdown(model: TableModel): string
writeConceptsMarkdown(model: ConceptsModel): string

// Prompt assembly
formatSchemaForNlToSql(schema: NormalizedSchema, options?: FormatOptions): string
```

`schema.json` shape (physical layer):
```json
{
  "version": 2,
  "schemaId": "string",
  "tables": [
    {
      "id": "table:public.orders",
      "name": "orders",
      "schema": "public",
      "columns": [
        { "id": "table:public.orders#id", "name": "id", "type": "integer", "sensitive": false }
      ]
    }
  ]
}
```

`tables/<table>.md` front-matter shape:
```yaml
---
id: table:public.orders
description: "Placed customer orders"
aliases: [sales, purchases]
primaryEntity: order
columns:
  - id: table:public.orders#total
    description: "Order total in cents"
---
```

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Loader accepts a v2 directory, bundled JSON, and a path to `schema.json` inside a directory; returns a normalized shape in each case.
- Loader rejects the pre-v2 format with a structured error pointing at the breaking-change note.
- Round-trip: `parse(write(parse(file)))` equals `parse(file)` for structured front-matter fields; markdown body bytes preserved verbatim.
- Unknown front-matter key produces an error; orphaned `id` (not in `schema.json`) produces a stale-id warning.
- Golden DDL output for the v2 fixture includes table descriptions, aliases, `Common query language` blocks; sensitive describable-layer fields are absent.
- A v2 directory with only `schema.json` (no `tables/*.md`) produces DDL equivalent to the bare baseline.
- Bundle round-trip: `loadSchema(bundle.json)` produces the same normalized representation as `loadSchema(directory)`.
- Two consecutive loader runs on the same artifact produce identical output.
