---
"@askdb/enrich": minor
"@askdb/studio": patch
---

Add `@askdb/enrich` as the shared Schema v2 enrichment workspace package.

Studio and TUI now both depend on `@askdb/enrich` for workspace loading,
draft construction, markdown section updates, persistence helpers, and AI
suggestion target/context builders. Studio no longer depends on `@askdb/tui`.
