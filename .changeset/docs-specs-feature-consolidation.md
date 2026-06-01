---
---

Consolidate phase-based spec directories into feature-based spec files.

Replace 10 phase directories (each with `requirements.md`, `plan.md`, `validation.md`) with 10 single-file feature specs named by feature: `core-pipeline`, `modes-and-observability`, `http-api`, `distribution`, `schema-format`, `introspection`, `schema-authoring-and-enrichment`, `rag`, `studio`, `multi-tenancy`. Each spec is a living present-tense source of truth with Overview, Scope, Design decisions, API surface, and Test bar sections. Phase 2 and 2.5 are merged into one file. Cross-references updated in roadmap, ADRs, and contract docs. `core-pipeline.md` updated to reflect `AskDbLanguageModel` and the `@askdb/ai` provider split.
