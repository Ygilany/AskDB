# Platform

This document records the **initial** technical baseline for AskDB (runtime, stack, and repo shape). Adjustments are expected as requirements sharpen; the constitution should stay aligned with `mission.md` and `roadmap.md`.

## Package management

- **pnpm** for all installs, workspaces, and scripts.
- **Turborepo** for task orchestration and caching across the monorepo (build/test/lint), with `pnpm` as the package manager. Prefer `turbo run …` (or root `pnpm` scripts that invoke Turbo) so task ordering is declared and cacheable.

## Language and repo layout

- **TypeScript** as the primary language for application code, shared libraries, and tooling.
- **Monorepo** layout: separate packages for reusable core logic, headless surfaces, RAG, and the future web/embed experience.
- **Example consumer application (later)** — For development and QA, the repo may include a **small example app** that consumes the embeddable UI/SDK so we can exercise integration without relying on every consumer’s production host (see `roadmap.md`).
  - **Workspace conventions** — packages live under `packages/*`; each package owns its `build` / `test` scripts. Root scripts invoke Turbo to run these consistently.

### Published packages

AskDB ships as a small set of focused npm packages. Each one has a single responsibility and is consumable on its own:

| Package | Role | Status |
|---|---|---|
| `@askdb/core` | Headless library: schema parsing, prompt assembly, NL→SQL, validation, modes, logging, **executor seam** (BYO database driver). Stable, semver-versioned. Schema v2 reader/writer/prompt-assembly land in Phase 5. | Phase 4 (publish), Phase 5 (Schema v2) |
| `@askdb/cli` | `askdb` binary; thin wrapper over `@askdb/core`. Already shipped; published alongside core. | Phase 4 (publish) |
| `@askdb/http-api` | HTTP server surface; thin wrapper over `@askdb/core`. Already shipped (Phase 3). | Phase 4 (publish) |
| `@askdb/introspect` | Schema introspection: per-engine connector pattern that reads database catalogs (Postgres first) and emits a Schema v2 physical artifact. Live (BYO connection / executor) and air-gapped (run SQL templates, hand off the export bundle) front doors share one connector. | Phase 6 |
| `@askdb/tui` | `askdb-tui` (or `askdb enrich`) interactive enrichment surface; reads a Schema v2 physical artifact (typically produced by `@askdb/introspect`), AI-suggests descriptions/aliases, writes the **describable schema artifact** ([`docs/contracts/schema-v2.md`](contracts/schema-v2.md)). | Phase 7 |
| `@askdb/rag` | Chunker + retriever; **bring-your-own embedder** (AI SDK `embed()` style) and **bring-your-own vector store** (in-memory default, file-backed, pgvector adapters). Wires into `@askdb/core` `ask()` as an optional retriever. | Phase 8 |

A future **`@askdb/sdk`** + **embeddable UI** package may follow once the headless surfaces stabilize (later phase).

`@askdb/core` is the only package other packages depend on. Wrappers stay thin and never duplicate prompt or validation logic — see [`docs/integration/reuse-core-phase-3.md`](integration/reuse-core-phase-3.md).

## Runtime and frameworks

- **Node.js** for CLI, local execution, and server-side packages.
- **Next.js** for the web application and embed-friendly UI, deployed on a **Vercel-friendly** workflow (preview deployments, environment separation).

## Web UI (first-party AskDB app)

The **AskDB web application** (anything we own and ship as our product UI) uses **Tailwind CSS** and **shadcn/ui**—no parallel in-repo component systems for that app.

Initialize shadcn for our Next monorepo app with this preset:

```bash
pnpm dlx shadcn@latest init --preset bdvw9Yrj --template next --monorepo
```

After init, add components with `pnpm dlx shadcn@latest add …` as needed.

## Integrators and headless use

**Headless** flows (CLI, MCP, HTTP API, SDK) do not require any AskDB UI. Users **bring their own frontend**: any framework and design system they choose. We publish contracts (types, API shapes, SDK calls)—not a mandated UI stack for consumers.

## Schema vs. database connectivity

- **Import-first** — Headless and first-party UIs must support workflows where AskDB **never holds credentials** to the customer’s database: users **import** schema descriptions (or paste exported metadata). Generation and review run against that **describable schema** artifact.
- **Optional live database** — When customers want **in-app execution**, validation against a live instance, or automated sync, they can attach **BYO** connection details on their infrastructure; that path is **not** required for schema enrichment, NL→SQL drafting, or export-only workflows.
- **Enrichment pipeline (headless-first)** — A Schema v2 physical layer (typically produced by `@askdb/introspect` in Phase 6, or hand-authored) is enriched into a **describable schema** through:
  - **`@askdb/tui`** — interactive terminal authoring with AI-suggest + human-confirm, producing the markdown + YAML front-matter artifact ([`docs/contracts/schema-v2.md`](contracts/schema-v2.md)).
  - **Web catalog UI** (later phase) — graphical alternative authoring against the **same** Schema v2 artifact.
  Both surfaces write the same on-disk format; consumers always read it through `@askdb/core`.

## Schema introspection

`@askdb/introspect` (Phase 6) is the package that turns a real database into a Schema v2 physical artifact.

- **Connector pattern** — One small `Connector` interface per engine. Phase 6 ships **only the Postgres connector** (`@askdb/introspect/postgres`); the seam is the entry point for additional engines added one at a time in [`roadmap.md`](roadmap.md) Phase 10.
- **Two front doors, one connector** — Both modes produce the **same** `IntrospectionResult` and the **same** on-disk artifact:
  - **Live** — pass an `AskDbExecutor` (the same seam Phase 4 introduces for `ask()`); the connector runs documented `pg_catalog` / `information_schema` queries against the live database.
  - **Air-gapped** — run the same SQL templates in `psql`, an IDE, or CI; export the rows as a bundle (CSV/JSON); hand the bundle path to `@askdb/introspect` and get an identical artifact without AskDB ever touching credentials.
- **Output** — a `<schemaId>.schema/` directory whose `schema.json` is the Schema v2 physical layer ([`docs/contracts/schema-v2.md`](contracts/schema-v2.md)). The describable layer (`tables/*.md`, `concepts.md`) is **never written or rewritten** by introspection; that belongs to `@askdb/tui` (Phase 7) or hand-authoring.
- **ID-anchored re-introspection** — On a second run against an existing artifact, only `schema.json` is rewritten. Stable IDs from the previous run are preserved; new columns appear with new IDs; orphaned IDs (deleted columns) surface as `IntrospectionResult.warnings` for the TUI to act on. The describable layer is preserved verbatim.
- **Determinism** — Catalog queries always include explicit `ORDER BY`; multi-column foreign keys preserve the constraint's column ordering, not the table's; enum values preserve their declared sort order. Two runs against an unchanged database produce a byte-identical `schema.json`.

## Schema description format

AskDB stores describable-schema knowledge as a **split artifact** designed for chunking and retrieval. The full contract is [`docs/contracts/schema-v2.md`](contracts/schema-v2.md):

- **Physical layer** — `<schemaId>.schema/schema.json` (JSON with stable IDs and relationships). Source of truth for what columns and relationships exist; usually produced by `@askdb/introspect` (Phase 6).
- **Describable layer** — `tables/<table>.md` with **YAML front-matter** (structured: aliases, tags, sensitive overrides, FK target IDs) and **markdown body** (prose: purpose, business context, common query language, example questions). Source of truth for how humans talk about the data.
- **Optional concepts** — `concepts.md` for cross-table vocabulary linking domain terms to table/column IDs.

Front-matter is validated by zod (round-trippable from the TUI); the markdown body is opaque to AskDB except via stable H2 anchors. JSON-only consumers can run a `bundle` step that compiles the split artifact into a single packed JSON for shipping.

## Data access

- **Postgres-first** — The first shipped path targets **PostgreSQL** end-to-end when a **live** connection or executor is used (connection, dialect assumptions in generation, execution, guardrails). Treat this as the **reference implementation** quality bar.
- **Pluggable executor seam** — `@askdb/core` ships a built-in Postgres executor (`pg`) but accepts an **integrator-supplied executor function** at the `ask()` boundary. Consumers using a different driver (postgres.js, Neon HTTP, Cloudflare Hyperdrive, a serverless pool, an MCP-mediated DB) plug in their own executor without forking. The executor contract is part of the published `@askdb/core` API. Recipes in [`docs/integration/installable-package.md`](integration/installable-package.md).
- **Other databases later** — Support for **additional engines** (beyond Postgres) lands in a **later roadmap phase**: per-engine drivers, dialect-aware generation/validation, and tests—rolled out **one database at a time** so we do not dilute safety or correctness. See **`roadmap.md`** (multi-database phase).

## AI and integrations

- **BYO chat model** — `ask({ model })` accepts any AI SDK `LanguageModel`. Customers wire OpenAI, Anthropic, Google, Bedrock, AI Gateway, Ollama, etc. without changes inside AskDB. Per-provider recipes in [`docs/integration/installable-package.md`](integration/installable-package.md).
- **BYO embedder** (Phase 8) — `@askdb/rag` chunking and retrieval accept any embedder function (AI SDK `embed()` / `embedMany()` shape). Default reference: `text-embedding-3-small`; nothing in `@askdb/core` requires it.
- **BYO vector store** (Phase 8) — `@askdb/rag` ships an `VectorStore` interface with adapters added one at a time: in-memory (default, zero deps), file-backed (`*.embeddings.bin` checked in next to the schema artifact), pgvector, then others as demand drives. Consumers pick the adapter or implement their own.
- **No mandatory vendors** — Nothing in the package requires an AskDB-owned account or service. Every external dependency is a seam the integrator chooses.

## Embeddability

- Target: **headless core + optional SDK** so teams can wire “ask your data” into their products; integrators own styling and components unless they choose to align with our patterns for consistency.
- If we later ship **optional** embed widgets or a UI kit, those would be our maintained surfaces (likely aligned with the first-party stack above); they remain **optional**—not a requirement for using AskDB.

## Release and versioning

- `@askdb/core` is published to npm with **semver** discipline. The contract surface (exports from `packages/core/src/index.ts` plus the formal contract docs under `docs/contracts/`) is the boundary that semver applies to.
- Companion packages (`@askdb/cli`, `@askdb/http-api`, `@askdb/introspect`, `@askdb/tui`, `@askdb/rag`) are versioned in lockstep where shared types matter; release tooling lives at the repo root (e.g. **changesets** — exact tooling decided in Phase 4).
- Pre-1.0 versions allow contract evolution; once 1.0 ships, breaking changes require a contract doc bump (e.g. `schema-v2` → `schema-v3`) and a major version.

## Other tooling

- Linter, formatter, and test runner follow repo conventions once added; versions are not fixed here.
