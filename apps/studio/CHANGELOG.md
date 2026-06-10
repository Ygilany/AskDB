# @askdb/studio

## 0.2.0-beta.22

### Patch Changes

- 8371033: Fix stale query results persisting when a new natural language query is submitted in the Playground.

  Previously, `executeResult` was not cleared when a new question was asked, so the previous results table remained visible until the user manually clicked "Execute Query" again. Submitting a new question now atomically clears both the generated SQL and the execution results.

  Refactored `playground-context` and `rag-context` to use named compound reducer actions (`start_ask`, `ask_succeeded`, `execute_completed`, `rag_build_completed`, `rag_query_completed`) instead of multiple sequential dispatches, so each logical state transition is atomic and clearly named.

## 0.2.0-beta.21

### Patch Changes

- 05a589a: Fix Studio execute endpoint not reading `databaseUrl` from `askdb.config.*`.

  `POST /api/execute` was reading `ASKDB_STUDIO_DATABASE_URL` directly from `process.env`, which is never populated because `bootstrapAskDbEnv` intentionally does not mutate `process.env`. The studio now reads `studio.execute.databaseUrl` via `getAskDbRuntimeConfig()`.

  `@askdb/config` gains `AskDbRuntimeStudioConfig` (exported) and a `studio` field on `AskDbRuntimeConfig`, making the studio database URL available through the typed runtime config accessor.

- Updated dependencies [05a589a]
  - @askdb/config@1.0.0-beta.7
  - @askdb/rag@0.2.0-beta.15

## 0.2.0-beta.20

### Patch Changes

- e4716c2: Fix warning badge illegibility in dark mode by adding `dark:` variant classes to the Badge CVA definition, following the same pattern used by Button.
- 3ca848a: Refactor studio UI components: split monolithic `ui.tsx` into individual files under `ui/`, migrate `Badge` to `cva`-based variants, update all import sites to point directly to individual component files, and remove the unused `@radix-ui/react-slot` dependency.

## 0.2.0-beta.19

### Patch Changes

- 330e1d2: Fix all 40 React Doctor issues (58→100/100): hoist Intl formatters, flatMap/reduce chained iterations, useReducer for 5 large state groups, useRef for non-rendered state, lazy useState initializer for mount state, stabilise useMemo deps, aria-label on unlabelled controls, bump tiny text to 12 px, extract large inline styles to CSS classes, move pure functions to module scope, and use semantic fieldset/ARIA patterns.
- e3616e5: Prevent Studio startup and route sync effects from re-running indefinitely after context provider state updates, and clear the remaining React Doctor warnings in Studio.
- 93a4c26: Add guided tenant scope controls in Studio with a generated `tenantScope` JSON preview.

## 0.2.0-beta.18

### Patch Changes

- dda0abf: Allow saved tenant policies to be reopened and edited in Studio.
- dda0abf: Keep AI enrichment suggestions available after using one candidate.
- dda0abf: Show untracked tables as a sidebar filter badge alongside enrichment status badges.
- Updated dependencies [dda0abf]
  - @askdb/core@1.0.0-beta.21
  - @askdb/rag@0.2.0-beta.14
  - @askdb/enrich@0.2.0-beta.8
  - @askdb/postgres@0.2.0-beta.11

## 0.2.0-beta.17

### Patch Changes

- bc8642f: Move AskDB AI provider construction helpers from `@askdb/core` into the new `@askdb/ai` registry and provider adapter packages.

  `@askdb/core` now exposes `AskDbLanguageModel` as its public model type and no longer installs concrete AI SDK provider packages. Consumers that used `createAskDbLanguageModelFromEnv`, embedding model factories, or AI config resolution from core should create an `@askdb/ai` registry with provider adapters such as `@askdb/ai-openai`.

- Updated dependencies [efe4a1b]
- Updated dependencies [bc8642f]
  - @askdb/postgres@0.2.0-beta.10
  - @askdb/ai@0.1.0-beta.1
  - @askdb/ai-openai@0.1.0-beta.1
  - @askdb/ai-azure@0.1.0-beta.1
  - @askdb/ai-google@0.1.0-beta.1
  - @askdb/core@1.0.0-beta.20
  - @askdb/enrich@0.2.0-beta.7
  - @askdb/rag@0.2.0-beta.13

## 0.2.0-beta.16

### Minor Changes

- 1eacf3f: Remove `database` config section; move connection URLs into `introspection` and `studio`.

  **Breaking:** `AskDbConfig.database` is removed. Move the Postgres connection URL from `database.providerConfig.postgres.databaseUrl` into `introspection.providerConfig.postgres.databaseUrl` (maps to `ASKDB_INTROSPECT_POSTGRES_URL`). The generic `DATABASE_URL` flat key is no longer set by `flattenAskDbConfig`.

  **Breaking:** Studio query execution (`POST /api/execute`) now reads `ASKDB_STUDIO_DATABASE_URL` instead of `DATABASE_URL`. Set `studio.execute.databaseUrl` in `askdb.config.*` (maps to `ASKDB_STUDIO_DATABASE_URL`).

  `AskDbRuntimeIntrospectionConfig` gains a new `postgresDatabaseUrl` field. The `DATABASE_URL` fallback for MySQL and SQL Server introspection is removed; configure those URLs explicitly via `introspection.providerConfig.<engine>.databaseUrl` or `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLSERVER_URL`.

### Patch Changes

- Updated dependencies [1eacf3f]
  - @askdb/config@1.0.0-beta.6
  - @askdb/rag@0.2.0-beta.12

## 0.2.0-beta.15

### Minor Changes

- 70a655c: Add untracked tables feature: tables marked as untracked are excluded from LLM prompts and RAG indexing while remaining visible in the schema and studio. Tracking status persists in the describable layer (tables/\*.md) and survives re-introspection. Studio UI adds a toggle in the Sensitivity tab and a visual indicator with filter in the table list.

### Patch Changes

- Updated dependencies [70a655c]
  - @askdb/core@0.5.0-beta.18
  - @askdb/enrich@0.2.0-beta.6
  - @askdb/rag@0.2.0-beta.11
  - @askdb/postgres@0.2.0-beta.9

## 0.2.0-beta.14

### Minor Changes

- 75a51f7: Complete IA redesign with topbar, nav rail, URL-based routing (react-router v7), and modular view architecture replacing the monolithic App.tsx

### Patch Changes

- @askdb/postgres@0.2.0-beta.8

## 0.2.0-beta.13

### Minor Changes

- 36c35b4: Add AI-drafted tenant policy creation flow: new `POST /api/suggest-tenant-policy` endpoint analyzes schema DDL and proposes a complete tenant policy for user review; manual configuration fallback with table/column dropdowns; editable review screen for roots, hierarchy, scoped tables, polymorphic tables, global tables, enforcement mode, and documentation body before confirming. Add `writeTenantPolicyMarkdown` to `@askdb/core` for round-trip serialization of tenant-policy.md.
- f314b37: Revamp Studio with adaptive navigation, UX polish, and a Query Playground.

  **Adaptive sidebar navigation**: the left sidebar now adapts to the active view — Tables and Concepts show the searchable table list, Tenancy shows a six-section nav (Roots, Hierarchy, Scoped Tables, Polymorphic Tables, Global Tables, Policy Warnings) with count badges and smooth scroll-to-section on click.

  **Query Playground**: a new fourth main view with a two-column layout — question input and tenant controls on the left, generated SQL and results on the right. Every successful generation is automatically saved to `playground-history.json` in the schema artifact directory. The history sidebar lets you restore, compare, and re-run past queries. When `DATABASE_URL` is configured, an Execute button runs the generated SQL in a read-only transaction and renders a results table (truncated at 500 rows).

  **UX polish**: success and neutral status messages auto-dismiss after 4 s (errors persist until resolved). The sidebar collapses on small screens with a hamburger toggle in the main content area; on large screens it is always pinned.

  **New server endpoints**: `GET /api/history`, `POST /api/history`, `DELETE /api/history/:id` (file-backed persistence), and `POST /api/execute` (read-only Postgres execution via lazy `pg` load).

### Patch Changes

- b791213: Remove duplicate Ask panel from the right inspector and add multi-tenancy to the docs-site sidebar.

  The Ask/generate-SQL workflow now lives exclusively in the Playground view. The right-side inspector panel is simplified to two tabs — RAG and Status — and the `AskPanel` component is removed. The `Bot` icon import and the `"ask"` `PanelKey` are also dropped.

  The multi-tenancy docs page (`/multi-tenancy/`) is now linked from the docs-site sidebar under Reference, making it discoverable through navigation.

- 0d0040a: Improve multi-tenancy UI readability with collapsible sections, better hierarchy edge layout, and template-seeded documentation. Add chevron toggles to all sections in both the saved policy view and draft review view; verbose sections (scoped tables, polymorphic tables, global tables, table coverage, frontmatter preview) default to collapsed. Move FK info to its own line in hierarchy edges, and seed documentation textarea with markdown headings instead of placeholder.
- Updated dependencies [36c35b4]
  - @askdb/core@0.5.0-beta.16
  - @askdb/enrich@0.2.0-beta.5
  - @askdb/postgres@0.2.0-beta.7
  - @askdb/rag@0.2.0-beta.10

## 0.2.0-beta.12

### Minor Changes

- 4d8d87f: Add multi-tenancy Studio surfaces: Tenancy configuration main view with coverage report, tenant roots, hierarchy, scoped/polymorphic/global tables, and policy warnings; Ask panel tenant scope controls with JSON input, SQL output mode toggle, and tenant binding display.

## 0.2.0-beta.11

### Patch Changes

- c7026a8: Add guided concept editing in Studio and improve TUI concept authoring prompts.
- Updated dependencies [c3c0f21]
  - @askdb/core@0.5.0-beta.14
  - @askdb/rag@0.2.0-beta.9
  - @askdb/enrich@0.2.0-beta.4
  - @askdb/postgres@0.2.0-beta.6

## 0.2.0-beta.10

### Patch Changes

- Updated dependencies [5ceadc8]
- Updated dependencies [5ceadc8]
  - @askdb/config@0.3.0-beta.5
  - @askdb/rag@0.2.0-beta.8

## 0.2.0-beta.9

### Minor Changes

- 02edcc5: Add Google Gemini as a supported AI provider.

  Set `ASKDB_AI_PROVIDER=google` and `GOOGLE_GENERATIVE_AI_API_KEY` (or the universal `ASKDB_AI_API_KEY`) to use Gemini models. The default model is `gemini-2.0-flash`; override with `ASKDB_AI_MODEL` or `GOOGLE_AI_MODEL`. The `google` provider is also configurable via `askdb.config.*` using the existing `providerConfig.google` branch.

### Patch Changes

- Updated dependencies [02edcc5]
  - @askdb/config@0.3.0-beta.4
  - @askdb/core@0.5.0-beta.12
  - @askdb/rag@0.2.0-beta.7
  - @askdb/enrich@0.2.0-beta.3
  - @askdb/postgres@0.2.0-beta.5

## 0.2.0-beta.8

### Patch Changes

- eff2f5d: Fix alias, tags, and enum fields in the studio to allow spaces and multi-word entries. Previously, spaces were stripped and commas swallowed on every keystroke because `parseList` ran inside `onChange`. A new `ListInput` component holds the raw string locally and only parses on blur. AI suggestions now append to existing values rather than replacing them.
- Updated dependencies [cd364e3]
  - @askdb/postgres@0.2.0-beta.4

## 0.2.0-beta.7

### Minor Changes

- 1f46cd1: Remove per-app model override config keys (`tui.model`, `studio.model`, `studio.rag`).

  The `tui.model` / `ASKDB_TUI_MODEL` and `studio.model` / `ASKDB_STUDIO_MODEL` config keys are removed — the AI model is now always resolved from the shared `ai` provider config (`ASKDB_AI_MODEL`, `ASKDB_MODEL`, etc.). The `studio.rag` nested block and its `ASKDB_STUDIO_RAG_*` env var aliases are also removed; Studio RAG now reads purely from the top-level `rag` config (`ASKDB_RAG_EMBEDDER*`). The `modelEnvVar` option is removed from `ResolveAskDbAiConfigOptions` as it is no longer needed for language models.

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/config@0.3.0-beta.3
  - @askdb/core@0.5.0-beta.10
  - @askdb/rag@0.2.0-beta.6
  - @askdb/enrich@0.2.0-beta.2
  - @askdb/postgres@0.2.0-beta.3

## 0.2.0-beta.6

### Patch Changes

- 0084012: Add `ensureSchema()` to the pgvector adapter and auto-invoke it in Studio on every RAG operation, eliminating the "relation does not exist" error when pgvector is configured. Add `askdb-rag setup-store` CLI command for explicit schema provisioning in CI and production pipelines.
- Updated dependencies [0084012]
  - @askdb/rag@0.2.0-beta.5

## 0.2.0-beta.5

### Patch Changes

- Updated dependencies [0f9a8a9]
  - @askdb/rag@0.2.0-beta.4

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
