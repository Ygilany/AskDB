# @askdb/studio

## 0.2.0-beta.4

### Patch Changes

- 52cfa58: Honor the configured `rag.store` branch in Studio RAG flows and expose pgvector store metadata in Studio status.
- Updated dependencies [52cfa58]
  - @askdb/rag@0.2.0-beta.3

## 0.2.0-beta.3

### Patch Changes

- 9c01a6d: Running **`askdb enrich`** and **`askdb studio`** with no arguments now opens the schema directory resolved from `askdb.config` (`introspection.outputDir` → `ASKDB_INTROSPECT_OUT` env → `./askdb/`) instead of printing usage. Pass **`--schema <dir>`** to override, or **`--help`** for the command reference.

## 0.2.0-beta.2

### Patch Changes

- Updated dependencies [07dbc9a]
- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
- Updated dependencies [57db375]
  - @askdb/config@0.3.0-beta.2
  - @askdb/core@0.5.0-beta.4
  - @askdb/postgres@0.2.0-beta.2
  - @askdb/rag@0.2.0-beta.2
  - @askdb/enrich@0.2.0-beta.1

## 0.2.0-beta.1

### Patch Changes

- Updated dependencies [06e5f54]
  - @askdb/config@0.3.0-beta.1
  - @askdb/rag@0.2.0-beta.1
  - @askdb/postgres@0.2.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- 5e20605: Add shared AI provider configuration for the bundled apps.

  `@askdb/core` now exports helpers for resolving environment-based OpenAI and Azure OpenAI / Microsoft Foundry configuration and constructing the corresponding AI SDK language model. The CLI, HTTP API, Studio, and TUI now use those helpers so users can bring OpenAI-compatible or Azure-hosted model credentials through provider-native env vars or the universal `ASKDB_AI_*` aliases.

- 48bfb62: Add `@askdb/studio`, a local browser UI for Schema v2 enrichment. Studio can browse tables and columns, edit describable metadata, save `tables/*.md`, request AI enrichment suggestions with the configured OpenAI-compatible key, and generate sample NL-to-SQL output against the saved schema enrichment.

  The main CLI now exposes `askdb studio --schema <dir>` as a shim for the Studio app. The shared TUI workspace save helper now creates `tables/` when needed so first-time describable files can be written from both UI surfaces.

- 373a9a7: Internal refactor: introduce shared web primitives (`CopyButton`, `EmptyText`) and a `lib/format` helper module for `@askdb/studio`. Pure additions — the new modules are not yet imported by `App.tsx`, so no published artifact changes and no release is required.

### Patch Changes

- b0d84d7: Route RAG embeddings through provider-agnostic AI SDK helpers and have Studio default to the configured AskDB AI connection when an embedding-capable key is configured.
- dc9a6ce: Add `@askdb/config` for Prisma-style `askdb.config.*` / `.config/askdb.*` discovery, `env()` / `defineConfig`, and `bootstrapAskDbEnv()`. Wire bootstrap into the CLI (except `init`), HTTP API, and Studio. `askdb init` writes `askdb.config.ts` only (example `.env` guidance in comments).
- 373e152: Add `@askdb/enrich` as the shared Schema v2 enrichment workspace package.

  Studio and TUI now both depend on `@askdb/enrich` for workspace loading,
  draft construction, markdown section updates, persistence helpers, and AI
  suggestion target/context builders. Studio no longer depends on `@askdb/tui`.

- b24af19: **Breaking (`@askdb/config`):** `bootstrapAskDbEnv` installs a runtime snapshot (`getAskDbRuntimeConfig`) instead of merging AskDB settings into `process.env`. Legacy flat `askdb.config` exports are removed; use `defineConfig` only. `getAskDbRuntimeEnv` is removed—pass `getAskDbRuntimeConfig().ai.aiEnv` into `@askdb/core` env helpers.

  **`@askdb/core`:** Document and align with explicit `AskDbAiEnv` from `@askdb/config`.

  First-party apps and RAG/TUI entrypoints read configuration through the runtime façade.

- 6df0045: Add a Sample NL question toggle for generating SQL with either the full saved schema or the current Studio RAG index, and show retrieved chunks when RAG is used.
- daa2625: Surface AI SDK token usage in Studio for RAG indexing, RAG queries, and sample SQL generation.
- 767fcf2: Refine the Studio request usage summary layout to emphasize prompt, completion, and total tokens.
- 6df0045: Point package bins at checked-in wrapper files so workspace installs create command shims before build output exists.
- Updated dependencies [5e20605]
- Updated dependencies [b0d84d7]
- Updated dependencies [dc9a6ce]
- Updated dependencies [25980e4]
- Updated dependencies [373e152]
- Updated dependencies [ec3ae3d]
- Updated dependencies [289e63e]
- Updated dependencies [a90543b]
- Updated dependencies [fdfd059]
- Updated dependencies [b018d88]
- Updated dependencies [4e462eb]
- Updated dependencies [b24af19]
- Updated dependencies [cd23f50]
- Updated dependencies [daa2625]
- Updated dependencies [6df0045]
  - @askdb/core@0.5.0-beta.0
  - @askdb/rag@0.2.0-beta.0
  - @askdb/config@0.3.0-beta.0
  - @askdb/enrich@0.2.0-beta.0
  - @askdb/postgres@0.2.0-beta.0
