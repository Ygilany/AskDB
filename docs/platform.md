# Platform

This document records the technical baseline for AskDB (runtime, stack, and repo shape). Adjustments are expected as requirements sharpen; the constitution should stay aligned with `mission.md` and `roadmap.md`.

For the package-level architecture, diagrams, dependency boundaries, install profiles, and connector-vs-peer guidance, see [`docs/architecture.md`](architecture.md).

## Package management

- **pnpm** for all installs, workspaces, and scripts.
- **Turborepo** for task orchestration and caching across the monorepo (build/test/lint), with `pnpm` as the package manager. Prefer `turbo run …` (or root `pnpm` scripts that invoke Turbo) so task ordering is declared and cacheable.

## Language and repo layout

- **TypeScript** as the primary language for application code, shared libraries, and tooling.
- **Monorepo** layout: separate packages for reusable core logic, AI providers, configuration, introspection and engines, RAG and enrichment, plus apps for the CLI, the HTTP API, Studio and the docs site.
- **Example consumer applications** — `examples/` holds small consumer apps (`ask-question`, `express-server`), an install smoke test (`installable-smoke`) and the consumer lab, which tests installed AskDB as a black box (see `roadmap.md`).
  - **Workspace conventions** — libraries live under `packages/*` and first-party apps under `apps/*`; each one owns its `build` / `test` scripts. Root scripts invoke Turbo to run these consistently.

### Published packages

AskDB ships as a set of focused npm packages. Each one has a single responsibility and is consumable on its own. Today every package publishes `-beta.N` prereleases. The **At 1.0** column is the maintainer's 2026-11-05 decision (#354).

| Package | Role | At 1.0 |
|---|---|---|
| `@askdb/core` | Headless library: schema parsing, prompt assembly, NL→SQL, validation, modes, logging, and retrieval input. Returns SQL only. | 1.0.0 |
| `@askdb/client` | Config-aware facade (`createAskDb`): resolves schema, model, and dialect from config so callers only pass a question. | 1.0.0 |
| `@askdb/config` | `defineConfig`, `env()`, and `askdb.config.*` discovery for first-party apps. | 1.0.0 |
| `@askdb/ai` | AI provider registry: resolves AskDB config into AI SDK language and embedding models, with built-in OpenAI, Azure OpenAI, Google Gemini, Anthropic, and Vercel AI Gateway providers. | 1.0.0 |
| `askdb` | The `askdb` binary (`init`, `introspect`, `ask`, `studio`, `enrich`, `bundle`, `rag`); a wrapper over the other packages. | 1.0.0 |
| `@askdb/http-api` | HTTP server surface over `@askdb/core`; `POST /ask` returns checked SQL only. | 1.0.0 |
| `@askdb/introspect` | Schema introspection: engine-agnostic `Connector` contract, orchestrator, connector registry (`createConnectorRegistry`), `@askdb/introspect/kit` helpers that engine packages build on, and Schema v2 renderer. Engine packages supply the connectors. | 1.0.0 |
| `@askdb/postgres` | Postgres engine package: introspection connector (live and from-export bundle), catalog SQL templates, and a `pg`-backed catalog query runner. | 1.0.0 |
| `@askdb/mysql` | MySQL and MariaDB engine package: introspection connector via `information_schema` and a `mysql2`-backed catalog query runner. | 1.0.0 |
| `@askdb/sqlite` | SQLite engine package: introspection connector via `sqlite_master` and PRAGMA functions, and a `better-sqlite3`-backed catalog query runner. | 1.0.0 |
| `@askdb/sqlserver` | SQL Server engine package: introspection connector via `sys.*` catalog views and an `mssql`-backed catalog query runner. | 1.0.0 |
| `@askdb/prisma` | Schema-file introspection connector for Prisma schemas. | 1.0.0 |
| `@askdb/enrich` | Headless Schema v2 enrichment workspace helpers: load/save authoring workspaces, build table drafts, preserve markdown sections, validate concept links, bundle split artifacts, and build AI suggestion targets/context. Shared by Studio and custom authoring surfaces. | stays 0.x |
| `@askdb/rag` | Chunker + retriever; **bring-your-own embedder** (AI SDK `embed()` style) and **bring-your-own vector store** (in-memory default, file-backed, pgvector adapters). Wires into `@askdb/core` `ask()` as an optional retriever. | stays 0.x |
| `@askdb/studio` | Local browser UI for Schema v2 enrichment and sample NL-to-SQL checks, built on `@askdb/enrich`. `askdb studio` opens it. | stays 0.x |

A future **`@askdb/sdk`** + **embeddable UI** package may follow once the headless surfaces stabilize (later phase).

Shared dependencies are layered by concern. `@askdb/core` is the schema/NL-to-SQL contract package. `@askdb/enrich` depends on Core and owns reusable Schema v2 authoring workflow logic. UI surfaces such as `@askdb/studio` depend on `@askdb/enrich` rather than owning workspace logic themselves. See [AskDB Architecture](architecture.md) and [ADR 0004 — Enrichment-package boundary](adrs/0004-enrichment-package-boundary.md).

## Runtime and frameworks

- **Node.js** for the CLI, the HTTP API, Studio's local server, and the other server-side packages.
- **Vite + React** for Studio, a local browser app that the `askdb studio` command serves on the developer's machine.

## Web UI (first-party AskDB app)

The **AskDB web application** (anything we own and ship as our product UI, today Studio) uses **Tailwind CSS** and **shadcn/ui**—no parallel in-repo component systems for that app.

Studio's shadcn setup lives in `apps/studio/components.json`. Add components from `apps/studio` with `pnpm dlx shadcn@latest add …` as needed.

## Integrators and headless use

**Headless** flows (library, CLI, HTTP API; MCP after 1.0) do not require any AskDB UI. Users **bring their own frontend**: any framework and design system they choose. We publish contracts (types, API shapes, library calls)—not a mandated UI stack for consumers.

## Schema vs. database connectivity

- **Import-first** — Headless and first-party UIs must support workflows where AskDB **never holds credentials** to the customer’s database: users **import** schema descriptions (or paste exported metadata). Generation and review run against that **describable schema** artifact.
- **Optional live database** — When customers want live schema introspection, they can attach **BYO** connection details on their infrastructure. That path is **not** required for schema enrichment, NL→SQL drafting, or export-only workflows.
- **Enrichment pipeline (headless-first)** — A Schema v2 physical layer (typically produced by `@askdb/introspect` in Phase 6, or hand-authored) is enriched into a **describable schema** through:
  - **`@askdb/enrich`** — shared headless workspace logic for loading, editing, saving, validating, and bundling the markdown + YAML front-matter artifact ([`docs/contracts/schema-v2.md`](contracts/schema-v2.md)).
  - **`@askdb/studio`** — local browser authoring with AI-suggest + human-confirm, sample NL-to-SQL checks, and RAG-indexed schema exploration, built on `@askdb/enrich`.
  - **Web catalog UI** (later phase) — graphical alternative authoring against the **same** Schema v2 artifact. All surfaces write the same on-disk format; consumers always read it through `@askdb/core`.

## Schema introspection

`@askdb/introspect` (Phase 6) is the package that turns a real database into a Schema v2 physical artifact.

- **Connector pattern** — One small `Connector` interface per engine. Each engine package supplies its connector: `@askdb/postgres` (Phase 6), then `@askdb/mysql` (MySQL and MariaDB), `@askdb/sqlite`, `@askdb/sqlserver`, and `@askdb/prisma` for Prisma schema files, added one at a time in [`roadmap.md`](roadmap.md) Phase 11. Each engine package also exports a connector provider adapter, which hosts register with `createConnectorRegistry` (ADR 0008).
- **Two front doors, one connector** — For Postgres, both modes produce the **same** `IntrospectionResult` and the **same** on-disk artifact. MySQL, MariaDB, SQLite and SQL Server support the live front door only. `@askdb/prisma` needs no database: it reads a Prisma schema file and rejects a connection URL.
  - **Live** — pass a `CatalogQueryRunner`; the connector runs documented catalog queries against the live database (`pg_catalog` / `information_schema` on Postgres, `information_schema` on MySQL and MariaDB, `sqlite_master` and PRAGMA functions on SQLite, `sys.*` views on SQL Server).
  - **Air-gapped** (Postgres only) — run the same SQL templates in `psql`, an IDE, or CI; export the rows as a bundle (CSV/JSON); hand the bundle path to `@askdb/introspect` and get an identical artifact without AskDB ever touching credentials.
- **Output** — a `<schemaId>.schema/` directory whose `schema.json` is the Schema v2 physical layer ([`docs/contracts/schema-v2.md`](contracts/schema-v2.md)). The describable layer (`tables/*.md`, `concepts.md`) is **never written or rewritten** by introspection; that belongs to `@askdb/enrich`-backed authoring surfaces (`@askdb/studio` or custom UIs) or hand-authoring.
- **ID-anchored re-introspection** — On a second run against an existing artifact, only `schema.json` is rewritten. Stable IDs from the previous run are preserved; new columns appear with new IDs; orphaned IDs (deleted columns) surface as `IntrospectionResult.warnings` for authoring surfaces to act on. The describable layer is preserved verbatim.
- **Determinism** — Catalog queries always include explicit `ORDER BY`; multi-column foreign keys preserve the constraint's column ordering, not the table's; enum values preserve their declared sort order. Two runs against an unchanged database produce a byte-identical `schema.json`.

## Schema description format

AskDB stores describable-schema knowledge as a **split artifact** designed for chunking and retrieval. The full contract is [`docs/contracts/schema-v2.md`](contracts/schema-v2.md):

- **Physical layer** — `<schemaId>.schema/schema.json` (JSON with stable IDs and relationships). Source of truth for what columns and relationships exist; usually produced by `@askdb/introspect` (Phase 6).
- **Describable layer** — `tables/<table>.md` with **YAML front-matter** (structured: aliases, tags, sensitive overrides, FK target IDs) and **markdown body** (prose: purpose, business context, common query language, example questions). Source of truth for how humans talk about the data.
- **Optional concepts** — `concepts.md` for cross-table vocabulary linking domain terms to table/column IDs.

Front-matter is validated by zod (round-trippable through `@askdb/enrich` authoring helpers); the markdown body is opaque to AskDB except via stable H2 anchors. JSON-only consumers can run a `bundle` step that compiles the split artifact into a single packed JSON for shipping.

## Data access

- **Postgres is the reference engine** — Postgres shipped first and stays the **reference implementation** quality bar for dialect assumptions in generation, validation guardrails, and introspection.
- **Five engine families at 1.0** — PostgreSQL, MySQL, MariaDB, SQLite and SQL Server are supported. They were added in roadmap Phase 11 **one database at a time** (driver, dialect-aware generation and validation, tests) so we do not dilute safety or correctness. The consumer lab covers every one, including its tenant suite.
- **No generated-SQL execution in core** — `@askdb/core` returns checked SQL only. Applications own any later approval, execution, read-only roles, network policy, and audit logging outside AskDB.

## AI and integrations

- **Two equal ways to supply a model** — `ask({ model })` accepts any AI SDK `LanguageModel`, so customers can wire OpenAI, Anthropic, Google, Bedrock, AI Gateway, Ollama, etc. without changes inside AskDB. `@askdb/ai`'s built-in providers (OpenAI, Azure OpenAI, Google Gemini, Anthropic, Vercel AI Gateway) resolve a model from AskDB config through `createAiRegistry()` or `createAskDb({ config })`. Pick by who owns provider config: the host app, or `askdb.config`. Per-provider config recipes in [`docs/integration/installable-package.md`](integration/installable-package.md).
- **BYO embedder** (Phase 8) — `@askdb/rag` chunking and retrieval accept any embedder function (AI SDK `embed()` / `embedMany()` shape). Default reference: `text-embedding-3-small`; nothing in `@askdb/core` requires it.
- **BYO vector store** (Phase 8) — `@askdb/rag` ships an `VectorStore` interface with adapters added one at a time: in-memory (default, zero deps), file-backed (`*.embeddings.bin` checked in next to the schema artifact), pgvector, then others as demand drives. Consumers pick the adapter or implement their own.
- **No mandatory vendors** — Nothing in the package requires an AskDB-owned account or service. Every external dependency is a seam the integrator chooses.

## Embeddability

- Target: **headless core + optional SDK** so teams can wire “ask your data” into their products; integrators own styling and components unless they choose to align with our patterns for consistency.
- If we later ship **optional** embed widgets or a UI kit, those would be our maintained surfaces (likely aligned with the first-party stack above); they remain **optional**—not a requirement for using AskDB.

## Release and versioning

- Packages are published to npm with **semver** discipline, using **Changesets**. For `@askdb/core`, the contract surface (exports from `packages/core/src/index.ts` plus the formal contract docs under `docs/contracts/`) is the boundary that semver applies to. The release process and checklist live in [`docs/release.md`](release.md).
- **At 1.0**, `@askdb/core`, `@askdb/client`, `@askdb/config`, `@askdb/ai`, `askdb`, `@askdb/http-api`, `@askdb/introspect` and the engine packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`) go to 1.0.0. `@askdb/studio`, `@askdb/enrich` and `@askdb/rag` stay 0.x, and their APIs may still move (#354, [ADR 0030](adrs/0030-1-0-promises-checked-sql-only.md)).
- **Experimental surfaces in the 1.0 set** — the `studio` and `rag` blocks of `defineConfig` in `@askdb/config` (with the types and environment variables that feed them), the `askdb studio`, `enrich`, `bundle` and `rag` commands, and `askdb init`'s RAG and Studio flags follow their 0.x packages. They are experimental, and a minor release of `@askdb/config` or `askdb` may change them ([ADR 0030](adrs/0030-1-0-promises-checked-sql-only.md)).
- Pre-1.0 versions allow contract evolution; once 1.0 ships, breaking changes to a 1.0 package outside those experimental surfaces require a contract doc bump where a contract changes (e.g. `schema-v2` → `schema-v3`) and a major version.

## Other tooling

- Linter, formatter, and test runner follow repo conventions once added; versions are not fixed here.
