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
- `saveTable()` — round-trippable write through the Phase 5 writer. New table files get a filename-safe `<table>.md`, or `<schema>.<table>.md` when bare names collide (including names a case-insensitive file system stores as one) or `<table>.md` is already taken; existing files keep their names (matched by front-matter `id`); writes outside `tables/` are refused. See [schema-v2 contract](../contracts/schema-v2.md#describable-layer--tablestablemd).
- Markdown body section update helpers (replace H2 sections without touching the rest)
- `concepts.md` loading, saving, and link validation
- `saveTenantPolicy()` — saves `tenant-policy.md` after checking it with the core loader's rules; a policy `loadSchema()` would reject throws `SchemaParseError` and nothing is written. See the [tenant policy contract](../contracts/tenant-policy.md#file-location).
- AI suggestion source, target, and context helpers (builds the enrichment prompt; caller supplies the model)
- `bundleSchemaDirectory(dir) → BundledSchemaV2` (the bundle type `@askdb/core` exports) — compiles a schema directory (`schema.json`, `tables/*.md`, `concepts.md`, `tenant-policy.md`) into a single packed JSON

### Out of scope

- Live database execution or introspection — see [`introspection.md`](./introspection.md)
- Web-based authoring UI — see [`studio.md`](./studio.md)
- Tenant policy authoring — see [`multi-tenancy.md`](./multi-tenancy.md)

## Design decisions

- **Enrich is a headless library, not a UI** — authoring surfaces (Studio, custom UIs) depend on `@askdb/enrich`; workspace logic never lives inside a UI package. See [ADR 0004](../adrs/0004-enrichment-package-boundary.md).
- **Confirm before save** — AI suggestions are never auto-applied. Every suggestion is presented for human review. This is a trust-first principle: the human is the author; the AI is a typing assistant.
- **Front-matter-only writes** — the writer touches only YAML front-matter. Markdown body (prose, examples) is preserved verbatim. Hand-edited prose is safe.
- **Idempotency** — opening a workspace, reviewing without editing, and quitting leaves every file byte-identical. No hidden rewrites.
- **Sensitivity overrides are escalate-only** — a draft's table-level or column-level `sensitive` is written to front-matter, and the core loader honors `sensitive: true` on top of `schema.json`. `sensitive: false` cannot un-mark a table or column `schema.json` marks sensitive; the loader ignores it and emits a `sensitivity_downgrade_ignored` warning (surfaced in `Workspace.warnings`). Authoring surfaces must compute "effective" sensitivity the same way (Studio does it in one helper, `apps/studio/src/web/lib/sensitivity.ts`, shared by the Sensitivity and Enrichment tabs). A draft built from front-matter that lists a column more than once is sensitive if any entry says `sensitive: true`, so saving the draft (which writes one entry per column) never drops an escalation. `buildFrontmatter()` given the file's existing front-matter carries through `columns[]` entries for other tables' columns unchanged, and `WorkspaceTable.escalatedByOtherFiles` lists the table's columns that another file escalates, so the UI can show them as sensitive. See [`schema-v2.md` → Sensitive propagation](../contracts/schema-v2.md#sensitive-propagation).

## Contracts and API surface

```ts
// @askdb/enrich (all synchronous)
import { loadWorkspace, saveTable, bundleSchemaDirectory } from '@askdb/enrich'
import type { BundledSchemaV2 } from '@askdb/core'

loadWorkspace(schemaDir: string): Workspace

interface Workspace {
  schemaDir: string
  physical: V2SchemaJson
  tables: WorkspaceTable[]       // each paired with its tables/*.md file (by front-matter id) or a default filename
  concepts: ParsedConceptsMarkdown | undefined
  warnings: SchemaV2Warning[]    // loader warnings: orphan IDs, ignored downgrades, ...
}

saveTable(workspace: Workspace, tableId: string, frontmatter: V2TableFrontmatter, body: string): void

bundleSchemaDirectory(schemaDir: string): BundledSchemaV2

// AI suggestion helpers: `schema` is loadSchema()'s result, so effective sensitivity applies
buildSuggestionTarget(schema: NormalizedSchemaV2, source: SuggestSource): EnrichmentTarget
buildSuggestionContext(schema: NormalizedSchemaV2, tableId: string): EnrichmentContext
```

The suggestion prompt (`suggestEnrichment` in `@askdb/core`) follows `modes.omitSensitiveFromPrompt` like `ask()`: the host passes it as `omitSensitiveIdentifiersFromPrompt`, and a sensitive column can't be a suggestion target while it's on ([ADR 0026](../adrs/0026-every-prompt-follows-omission.md)).

```sh
# CLI surface
askdb enrich [--schema <path>]      # opens Studio on the schema artifact
askdb bundle <dir> --out <f>        # bundle directory to JSON via @askdb/enrich; exits 1 and writes nothing if loadSchema() refuses it
```

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- `@askdb/enrich`: workspace loading/saving, draft construction, markdown section replacement, concepts persistence, concept link validation, and bundling all covered without terminal or browser dependencies.
- `@askdb/studio` imports shared helpers from `@askdb/enrich` and owns no workspace logic of its own.
- AI-suggest with mock model: suggestion queued; only persists on confirm; no file changes without confirm.
- Idempotency: opening, viewing, and quitting without edits leaves files byte-identical.
- Sensitive warning: description mentioning a sensitive column name emits warning without blocking save.
- Sensitivity round-trip: a draft sensitivity override saved via `saveTable()` is honored by `loadSchema()` (escalate-only), in both directory and bundle form.
- Re-introspection ingestion: new un-described column IDs queued for description; orphan IDs offered for pruning.
- Bundle round-trip: `loadSchema(bundle.json)` produces the same normalized representation as `loadSchema(directory)`, including the tenant policy for multi-tenant schemas.
- Table filenames: colliding bare names get schema-qualified files, including names a case-insensitive file system treats as one; over-long names are shortened with a hash suffix; identifiers with path separators or `..`, and symbolic or hard links in `tables/`, cannot redirect a write outside `tables/`; saves are atomic (temp file plus rename); existing filenames are never renamed.
- Concepts and tenant policy saves: a symbolic link at `concepts.md` or `tenant-policy.md` is refused, not followed; a hard link is replaced, not written through; saves are atomic; `saveTenantPolicy()` refuses a policy `loadSchema()` would reject and writes nothing.
