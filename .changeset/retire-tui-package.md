---
"askdb": minor
---

Retire the `@askdb/tui` terminal authoring surface in favor of Studio.

Studio (`askdb studio`) is a strict superset of the TUI for Schema v2
enrichment and has been the documented authoring surface since the
studio-first onboarding work. The `@askdb/tui` package is removed from the
workspace:

- `askdb enrich` now opens Studio (prints a one-line retirement notice and
  forwards arguments such as `--schema`).
- `askdb bundle <dir> --out <file>` now calls `@askdb/enrich` directly; the
  command was always headless and no longer routes through a UI package.
- The `askdb-tui` binary is no longer published.

All shared authoring logic (workspace loading, drafts, frontmatter
round-tripping, bundling, suggestion targets) already lives in
`@askdb/enrich`, so no enrichment behavior changes.
