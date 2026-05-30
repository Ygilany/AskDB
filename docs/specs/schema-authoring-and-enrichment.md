# Feature: Schema Authoring and Enrichment

**Status:** Complete  
**Packages:** `@askdb/enrich`, `@askdb/tui`

## Overview

Schema enrichment is the process of authoring the describable layer of a Schema v2 artifact — writing descriptions, aliases, common query language, and example questions into `tables/*.md` files and `concepts.md`. This turns a bare physical schema (produced by introspection) into a fully grounded artifact that improves NL→SQL quality.

Two packages handle this:

- **`@askdb/enrich`** — headless, shared workspace logic: loading a Schema v2 directory as an editable workspace, constructing and saving table drafts, round-tripping `tables/*.md` front-matter, managing `concepts.md`, building AI suggestion targets, and bundling a directory into a single JSON. This package is consumed by both the TUI and Studio.
- **`@askdb/tui`** — the interactive terminal authoring surface. Walks tables and columns, AI-suggests descriptions and aliases (BYO key), and presents each candidate for human confirm/edit/reject before saving. No auto-save.

The dependency direction: `@askdb/core ← @askdb/enrich ← @askdb/tui` and `@askdb/core ← @askdb/enrich ← @askdb/studio`. Studio does not depend on TUI. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).

## Scope

### In scope

**`@askdb/enrich`:**
- `Workspace` and `WorkspaceTable` — load a Schema v2 directory, expose tables as editable drafts
- Table draft construction from `tables/*.md` parsed front-matter
- `saveTable()` — round-trippable write through the Phase 5 writer
- Markdown body section update helpers (replace H2 sections without touching the rest)
- `concepts.md` loading, saving, and link validation
- AI suggestion source, target, and context helpers (builds the enrichment prompt; caller supplies the model)
- `bundleSchema(dir) → bundledJson` — compiles a v2 directory into a single packed JSON

**`@askdb/tui`:**
- Interactive terminal app (`askdb-tui` binary)
- Table list + per-table form: table description, aliases, `primaryEntity`, tags, per-column description/aliases/enum/sensitive override
- `Common query language` free-form editor, `Example questions` bullet-list editor
- AI-suggest with confirm-before-save: suggests candidates, user accepts/edits/rejects; batch `--auto-suggest-all` mode
- Sensitive-column warning when a description mentions a sensitive column name (non-blocking)
- Re-introspection ingestion: surfaces orphan IDs (offer prune) and new un-described IDs (queue for description)
- Idempotent: re-opening without edits leaves files byte-identical

### Out of scope

- Live database execution or introspection — see [`introspection.md`](./introspection.md)
- Web-based authoring UI — see [`studio.md`](./studio.md)
- Tenant policy authoring — see [`multi-tenancy.md`](./multi-tenancy.md)

## Design decisions

- **Separate enrich package from TUI** — when Studio was added it needed the same headless workspace behavior as the TUI. Keeping that logic in `@askdb/tui` would have made Studio depend on a terminal UI package. `@askdb/enrich` is the clean shared layer. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).
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

```ts
// @askdb/tui binary
askdb-tui --schema <path>         // open TUI on a v2 directory
askdb-tui bundle <dir> --out <f>  // bundle directory to JSON
```

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- `@askdb/enrich`: workspace loading/saving, draft construction, markdown section replacement, concepts persistence, concept link validation, and bundling all covered without Ink/terminal dependencies.
- `@askdb/tui` and `@askdb/studio` both import shared helpers from `@askdb/enrich`; Studio has no dependency on `@askdb/tui`.
- TUI headless author flow: mock-prompted walk through a fixture → edit table description → save → file content matches expected front-matter. Round-trip via Schema v2 writer.
- AI-suggest with mock model: suggestion queued; only persists on confirm; no file changes without confirm.
- Idempotency: opening, viewing, and quitting without edits leaves files byte-identical.
- Sensitive warning: description mentioning a sensitive column name emits warning without blocking save.
- Re-introspection ingestion: new un-described column IDs queued for description; orphan IDs offered for pruning.
- Bundle round-trip: `loadSchema(bundle.json)` produces the same normalized representation as `loadSchema(directory)`.
