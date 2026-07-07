# Feature: Schema Authoring and Enrichment

**Status:** Complete  
**Packages:** `@askdb/enrich`

## Overview

Schema enrichment is the process of authoring the describable layer of a schema artifact — writing descriptions, aliases, common query language, and example questions into `tables/*.md` files and `concepts.md`. This turns a bare physical schema (produced by introspection) into a fully grounded artifact that improves NL→SQL quality.

- **`@askdb/enrich`** — headless, shared workspace logic: loading a describable schema directory as an editable workspace, constructing and saving table drafts, round-tripping `tables/*.md` front-matter, managing `concepts.md`, building AI suggestion targets, and bundling a directory into a single JSON. This package is consumed by Studio and any custom authoring surface.

The dependency direction: `@askdb/core ← @askdb/enrich ← @askdb/studio`. UI surfaces never own workspace logic. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).

## Scope

### In scope

**`@askdb/enrich`:**
- `Workspace` and `WorkspaceTable` — load a describable schema directory, expose tables as editable drafts
- Table draft construction from `tables/*.md` parsed front-matter
- `saveTable()` — round-trippable write through the Phase 5 writer
- Markdown body section update helpers (replace H2 sections without touching the rest)
- `concepts.md` loading, saving, and link validation
- AI suggestion source, target, and context helpers (builds the enrichment prompt; caller supplies the model)
- `bundleSchema(dir) → bundledJson` — compiles a schema directory into a single packed JSON

### Out of scope

- Live database execution or introspection — see [`introspection.md`](./introspection.md)
- Web-based authoring UI — see [`studio.md`](./studio.md)
- Tenant policy authoring — see [`multi-tenancy.md`](./multi-tenancy.md)

## Design decisions

- **Enrich is a headless library, not a UI** — authoring surfaces (Studio, custom UIs) depend on `@askdb/enrich`; workspace logic never lives inside a UI package. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).
- **Confirm before save** — AI suggestions are never auto-applied. Every suggestion is presented for human review. This is a trust-first principle: the human is the author; the AI is a typing assistant.
- **Front-matter-only writes** — the writer touches only YAML front-matter. Markdown body (prose, examples) is preserved verbatim. Hand-edited prose is safe.
- **Idempotency** — opening a workspace, reviewing without editing, and quitting leaves every file byte-identical. No hidden rewrites.

## Contracts and API surface

```ts
// @askdb/enrich
import { openWorkspace, saveTable, bundleSchema } from '@askdb/enrich'

openWorkspace(schemaDir: string): Promise<Workspace>

interface Workspace {
  tables: WorkspaceTable[]
  warnings: WorkspaceWarning[]   // orphan IDs, new un-described IDs
}

saveTable(table: WorkspaceTable, draft: TableDraft): Promise<void>

bundleSchema(schemaDir: string): Promise<BundledSchema>

// AI suggestion helpers
buildSuggestSource(table: WorkspaceTable): SuggestSource
buildSuggestContext(workspace: Workspace): SuggestContext
```

```sh
# CLI surface
askdb enrich [--schema <path>]      # opens Studio on the schema artifact
askdb bundle <dir> --out <f>        # bundle directory to JSON via @askdb/enrich
```

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- `@askdb/enrich`: workspace loading/saving, draft construction, markdown section replacement, concepts persistence, concept link validation, and bundling all covered without terminal or browser dependencies.
- `@askdb/studio` imports shared helpers from `@askdb/enrich` and owns no workspace logic of its own.
- AI-suggest with mock model: suggestion queued; only persists on confirm; no file changes without confirm.
- Idempotency: opening, viewing, and quitting without edits leaves files byte-identical.
- Sensitive warning: description mentioning a sensitive column name emits warning without blocking save.
- Re-introspection ingestion: new un-described column IDs queued for description; orphan IDs offered for pruning.
- Bundle round-trip: `loadSchema(bundle.json)` produces the same normalized representation as `loadSchema(directory)`.
