# ADR 0004 — Enrichment-package boundary

## Status

Accepted (amended 2026-11).

> **Amendment (2026-11):** `@askdb/core` now owns file access to a schema directory: `readSchemaDirectory()` reads one ([ADR 0027](0027-core-reads-schema-directory-with-exact-names.md)), and `saveSchemaFile()` writes a file into one ([ADR 0028](0028-core-writes-schema-directory-files.md)). Which files a directory holds, and how a file is written there, are tenant-safety rules: copies in two packages drifted and failed open (#181, #608, #617). `@askdb/enrich` keeps the authoring workflow (`Workspace`, drafts, the `save*` helpers, `bundleSchemaDirectory()`) and calls core for the file access. Core still holds no authoring workflow.

> **Amendment (2026-07):** `@askdb/tui` has since been retired in favor of Studio; `askdb enrich` opens Studio and `askdb bundle` calls `@askdb/enrich` directly. The boundary this ADR established is unchanged — `@askdb/enrich` remains the shared headless authoring layer consumed by `@askdb/studio` and custom surfaces. TUI references below are preserved as historical context.

## Context

Phase 7 introduced `@askdb/tui` as the first authoring surface for the Schema v2 describable layer. Its implementation included both terminal UI code and reusable enrichment workspace logic:

- loading a Schema v2 workspace from disk
- building editable table drafts from parsed markdown
- saving `tables/*.md` and `concepts.md`
- preserving markdown sections while editing descriptions and common query language
- building AI suggestion targets and context
- bundling a split Schema v2 directory into a single JSON artifact

When `@askdb/studio` was added, it needed the same non-UI enrichment behavior. Depending directly on `@askdb/tui` made the browser/server Studio package depend on a terminal UI package, which blurred product boundaries and risked pulling UI-specific dependencies into non-terminal consumers.

## Decision

Create `@askdb/enrich` as the shared, headless enrichment workspace package.

The dependency direction is:

```text
@askdb/core
   ^
   |
@askdb/enrich
   ^          ^
   |          |
@askdb/tui   @askdb/studio
```

`@askdb/enrich` owns reusable Schema v2 enrichment authoring logic:

- `Workspace`, `WorkspaceTable`, and workspace loading
- table draft construction and front-matter construction
- table/concepts persistence helpers
- markdown body section update helpers
- suggestion source, target, and context helpers
- split-directory bundling

`@askdb/tui` owns terminal interaction, keyboard flows, Ink components, and the `askdb-tui` binary.

`@askdb/studio` owns the local browser UI and HTTP routes.

`@askdb/core` remains the schema contract and NL-to-SQL core: Schema v2 types, parsing/writing primitives, validation, prompt assembly, AI contracts, logging, modes, and `ask()`.

## Consequences

- Studio no longer depends on TUI.
- TUI and Studio share one implementation for Schema v2 enrichment workspace behavior.
- Core avoids becoming a catch-all for filesystem authoring workflows. (Amended 2026-11: core does own reading and writing the files of a schema directory, ADRs 0027 and 0028.)
- `@askdb/enrich` becomes a published API surface for consumers who want to build their own authoring UI without adopting the terminal UI or Studio.
- Existing `@askdb/tui` helper exports may continue to re-export from `@askdb/enrich` for compatibility, but new consumers should import shared enrichment helpers from `@askdb/enrich`.

## Alternatives Considered

### Keep shared helpers in `@askdb/tui`

Rejected. This keeps Studio coupled to a terminal UI package and makes `@askdb/tui` both an application surface and a shared domain library.

### Move shared helpers into `@askdb/core`

Rejected for now. The moved logic is authoring workflow and filesystem workspace behavior, not the core schema/NL-to-SQL contract. Keeping it outside Core preserves a smaller runtime-neutral core package.

## References

- [`docs/platform.md`](../platform.md) — package layout
- [`docs/contracts/schema-v2.md`](../contracts/schema-v2.md) — Schema v2 implementation locus
- [`docs/specs/schema-authoring-and-enrichment.md`](../specs/schema-authoring-and-enrichment.md) — enrichment authoring feature spec
