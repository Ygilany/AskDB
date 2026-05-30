# AskDB Architecture

This document is the canonical architecture guide for AskDB packages, package boundaries, install profiles, and extension seams. It complements the package READMEs, [Platform](platform.md), [Schema v2](contracts/schema-v2.md), and [Connector authoring](integration/connectors.md) docs.

## System overview

AskDB turns natural-language questions into schema-grounded SQL. The central runtime boundary is deliberate: AskDB returns SQL for review; the host application owns approval, execution, database roles, tenant policy, network controls, and audit logging.

```mermaid
flowchart LR
  asker["User or agent question"]
  host["Host app, CLI, HTTP API, or Studio"]
  schema["AskDB Schema v2<br/>directory, schema.json, or bundle"]
  core["@askdb/core<br/>load schema, assemble prompt, call model"]
  dialect["AskDialect<br/>engine-specific generation and validation"]
  model["BYO LanguageModel"]
  sql["Validated SQL artifact"]
  execution["Host-owned execution boundary"]

  asker --> host
  host --> schema
  host --> core
  schema --> core
  core --> dialect
  core --> model
  model --> core
  dialect --> core
  core --> sql
  sql --> execution
```

`@askdb/core` is dialect-agnostic. It does not import database drivers, does not own live database connections, and does not execute generated SQL. Database-specific behavior is supplied through integration packages such as `@askdb/postgres`.

## Package map

AskDB is a pnpm monorepo with reusable packages under `packages/*` and first-party product surfaces under `apps/*`. Some packages publish binaries, but their package boundary still follows the same rule: reusable contracts live in libraries and integrations; product workflows compose those contracts.

```mermaid
flowchart TB
  subgraph Contracts["Reusable contracts and libraries"]
    core["@askdb/core<br/>Schema v2, ask(), modes, logging, retrieval input"]
    introspect["@askdb/introspect<br/>Connector contract and Schema v2 renderer"]
    enrich["@askdb/enrich<br/>Headless enrichment workspace helpers"]
    rag["@askdb/rag<br/>Chunking, indexing, retriever wiring"]
  end

  subgraph Integrations["Integration packages"]
    postgres["@askdb/postgres<br/>Postgres dialect, connector, templates, runner"]
    prisma["@askdb/prisma<br/>Prisma schema-file connector"]
  end

  subgraph Surfaces["First-party surfaces"]
    cli["askdb<br/>askdb binary"]
    http["@askdb/http-api<br/>POST /ask wrapper"]
    tui["@askdb/tui<br/>terminal enrichment UI"]
    studio["@askdb/studio<br/>local browser authoring UI"]
    docsSite["@askdb/docs-site<br/>static documentation site"]
  end

  postgres --> core
  postgres --> introspect
  prisma --> introspect
  enrich --> core
  rag --> core
  tui --> enrich
  cli --> core
  cli --> introspect
  cli --> postgres
  cli --> prisma
  cli --> tui
  cli --> studio
  http --> core
  http --> postgres
  studio --> core
  studio --> enrich
  studio --> postgres
  studio --> rag
```

| Package | Purpose and scope | Boundary |
| --- | --- | --- |
| `@askdb/core` | Dialect-agnostic NL-to-SQL pipeline, Schema v2 loading/parsing, modes, logging, enrichment suggestions, and retriever input. | No database drivers, no generated-SQL execution, no engine-specific connector. |
| `@askdb/introspect` | Engine-agnostic `Connector<TInput>` contract, introspection orchestrator, and Schema v2 renderer. | No default connector, no engine-specific input union, no standalone binary. |
| `@askdb/postgres` | Postgres dialect, SQL prompt/validation helpers, live/from-export connector, catalog templates, and optional `pg` catalog runner. | `pg` is optional and only needed for live catalog reads; generated SQL still executes outside AskDB. |
| `@askdb/prisma` | Offline Prisma schema-file connector that renders Schema v2 physical metadata. | No live database connection and no SQL dialect. Pair output with a dialect such as `postgresDialect` when generating SQL. |
| `@askdb/enrich` | Headless Schema v2 authoring helpers: load/save workspace, table drafts, concepts, markdown preservation, suggestions, and bundling. | No terminal or browser UI. |
| `@askdb/tui` | Maintained terminal authoring surface over a Schema v2 directory. | Operates on files; does not introspect or connect to databases. |
| `@askdb/studio` | Maintained local browser UI for enrichment, sample NL-to-SQL checks, and local RAG exploration. | Authoring surface over Schema v2, not a connector package. |
| `@askdb/rag` | Deterministic Schema v2 chunking, BYO embedder/store interfaces, in-memory/file/pgvector adapters, and retriever wiring. | Optional layer; prompt generation still flows through `@askdb/core` and a dialect. |
| `askdb` | Batteries-included `askdb` workflow for ask, introspect, enrich, studio, and bundle commands. | Product surface that composes packages; not the reusable contract layer. |
| `@askdb/http-api` | Minimal HTTP wrapper around `@askdb/core` that returns SQL from `POST /ask`. | No duplicate NL-to-SQL implementation and no SQL execution. |
| `@askdb/docs-site` | Static documentation site. | Mirrors selected docs content; Markdown files remain canonical for architecture and contracts. |

## Dependency boundaries

The package graph is intentionally layered by responsibility.

```mermaid
flowchart BT
  core["@askdb/core"]
  introspect["@askdb/introspect"]
  enrich["@askdb/enrich"]
  rag["@askdb/rag"]
  postgres["@askdb/postgres"]
  prisma["@askdb/prisma"]
  tui["@askdb/tui"]
  studio["@askdb/studio"]
  cli["askdb"]
  http["@askdb/http-api"]

  enrich --> core
  rag --> core
  postgres --> core
  postgres --> introspect
  prisma --> introspect
  tui --> enrich
  studio --> enrich
  studio --> core
  studio --> postgres
  studio --> rag
  cli --> core
  cli --> introspect
  cli --> postgres
  cli --> prisma
  cli --> tui
  cli --> studio
  http --> core
  http --> postgres
```

Boundary rules:

- `@askdb/core` remains the schema and NL-to-SQL contract package. It receives a dialect, a model, an optional retriever, and a schema; it returns SQL.
- Integration packages own engine-specific knowledge. `@askdb/postgres` owns Postgres dialect behavior and Postgres catalog introspection. `@askdb/prisma` owns Prisma schema-file introspection.
- `@askdb/introspect` does not know whether an integration reads a live database, an export bundle, a file, or a future API. The connector input shape belongs to the connector package.
- `@askdb/enrich` owns reusable authoring behavior. `@askdb/tui` and `@askdb/studio` depend on it instead of depending on each other.
- `@askdb/rag` is optional. It can narrow schema context before `ask()`, but it does not replace dialect validation.
- First-party apps can be batteries-included. Reusable packages should stay small and should not pull optional drivers into unrelated workflows.

## Schema-to-SQL flow

```mermaid
sequenceDiagram
  autonumber
  participant Host as Host surface
  participant Core as @askdb/core
  participant Rag as Optional @askdb/rag retriever
  participant Dialect as AskDialect
  participant Model as BYO LanguageModel

  Host->>Core: ask({ question, schema, model, dialect, retriever? })
  Core->>Core: normalize Schema v2 context
  opt Retriever supplied
    Core->>Rag: retrieve focused schema chunks
    Rag-->>Core: relevant chunks and scores
    Core->>Core: synthesize focused DDL
  end
  Core->>Dialect: generate(question, schema context, model)
  Dialect->>Model: prompt for target SQL dialect
  Model-->>Dialect: model text
  Dialect-->>Core: generated SQL candidate
  Core->>Dialect: validate SQL candidate
  Dialect-->>Core: accepted SQL or validation error
  Core-->>Host: { sql, explain? }
```

The generated SQL is an output artifact. Running it is outside the AskDB package API by design.

## Introspection connector architecture

`@askdb/introspect` defines the connector contract and rendering flow. Connector packages supply the engine-specific source reader and input type.

```mermaid
flowchart TB
  caller["CLI or library caller"]
  orchestrator["@askdb/introspect<br/>introspect()"]
  contract["Connector of TInput<br/>describe(input), templates?()"]
  renderer["Schema v2 renderer"]
  out["schema-id.schema/<br/>schema.json"]

  pgLive["Postgres live input<br/>{ mode: live, runner, filters? }"]
  pgExport["Postgres export input<br/>{ mode: from-export, bundlePath, filters? }"]
  prismaFile["Prisma input<br/>{ schemaPath, schemaId?, filters? }"]

  pgConnector["@askdb/postgres<br/>createPostgresConnector()"]
  prismaConnector["@askdb/prisma<br/>createPrismaConnector()"]

  caller --> orchestrator
  pgLive --> pgConnector
  pgExport --> pgConnector
  prismaFile --> prismaConnector
  pgConnector --> contract
  prismaConnector --> contract
  orchestrator --> contract
  contract --> renderer
  renderer --> out
```

Connector capability matrix:

| Connector package | Input source | Live database | Export or offline mode | Dialect included | Optional peers |
| --- | --- | --- | --- | --- | --- |
| `@askdb/postgres` | PostgreSQL catalog metadata. | Yes, through a caller-supplied `CatalogQueryRunner` or `createPostgresCatalogQueryRunner()`. | Yes, through from-export bundles produced from the catalog templates. | Yes, `postgresDialect`. | `pg` for live introspection. |
| `@askdb/prisma` | One `schema.prisma` file or a directory of `.prisma` files. | No. | Yes, file-only introspection. | No. | None declared. |

## Enrichment flow

Introspection produces the physical layer. Enrichment authoring adds the describable layer that humans and RAG use for better grounding.

```mermaid
flowchart LR
  physical["schema.json<br/>physical layer"]
  workspace["@askdb/enrich<br/>loadWorkspace()"]
  authoring["Authoring surface<br/>TUI, Studio, or custom UI"]
  tables["tables/*.md<br/>descriptions, aliases, examples"]
  concepts["concepts.md<br/>domain vocabulary"]
  bundle["schema bundle JSON<br/>optional distribution artifact"]
  core["@askdb/core<br/>loadSchema()"]

  physical --> workspace
  workspace --> authoring
  authoring --> tables
  authoring --> concepts
  physical --> bundle
  tables --> bundle
  concepts --> bundle
  physical --> core
  tables --> core
  concepts --> core
  bundle --> core
```

`@askdb/tui` and `@askdb/studio` are maintained enrichment surfaces. They do not own the shared workspace logic and they do not need a live database connection to edit enrichment.

## RAG flow

RAG is an optional layer for large enriched schemas. It indexes Schema v2 chunks with consumer-selected embeddings and storage, then returns a retriever for `ask()`.

```mermaid
flowchart TB
  schema["Schema v2 directory or bundle"]
  chunker["@askdb/rag<br/>chunkSchema*()"]
  embedder["BYO Embedder<br/>AI SDK, OpenAI helper, or custom"]
  store["BYO VectorStore<br/>memory, file, pgvector, or custom"]
  lock["schema.lock.json<br/>content hashes"]
  retriever["Retriever"]
  core["@askdb/core ask()"]
  dialect["AskDialect validation"]
  sql["Validated SQL"]

  schema --> chunker
  chunker --> embedder
  embedder --> store
  chunker --> lock
  store --> retriever
  retriever --> core
  schema --> core
  core --> dialect
  dialect --> sql
```

Sensitive describable-layer content is excluded from RAG chunks by default. Identifier grounding and dialect guardrails remain part of the core SQL generation path.

## Install profiles

In the table below, "selected packages" are packages the consumer chooses for a workflow. "Automatically installed" means normal package dependencies pulled in by those selected packages. "Optional peers" are peer packages the consumer installs only when using a feature that needs them.

| Workflow | Selected packages | Automatically installed by those packages | Optional peers or provider packages | Notes |
| --- | --- | --- | --- | --- |
| Minimal Postgres SQL generation | `@askdb/core`, `@askdb/postgres` | `@askdb/postgres` pulls `@askdb/core`, `@askdb/introspect`, and `ai` as package dependencies. | Add a model provider such as `@ai-sdk/openai` when your runtime creates the model directly. Add `@askdb/ai` plus a provider adapter such as `@askdb/ai-openai` only if you want AskDB config/env model factories. `pg` is not needed. | Uses `ask()` plus `postgresDialect`; SQL execution remains host-owned. |
| Live Postgres introspection | `@askdb/introspect`, `@askdb/postgres` | `@askdb/postgres` pulls `@askdb/core` and `@askdb/introspect`. | `pg` for `createPostgresCatalogQueryRunner()`. | Callers can also supply their own `CatalogQueryRunner`. |
| Air-gapped Postgres introspection | `@askdb/introspect`, `@askdb/postgres` | Same as live Postgres introspection. | No `pg` required if using from-export bundles only. | Templates come from `POSTGRES_TEMPLATE_BUNDLE`. |
| Prisma schema-file introspection | `@askdb/introspect`, `@askdb/prisma` | `@askdb/prisma` pulls `@askdb/introspect` and `@prisma/internals`. | No database driver peer declared. | Produces Schema v2 physical metadata from Prisma files; no dialect included. |
| CLI workflow | `askdb` | Pulls first-party integrations and surfaces used by the `askdb` binary, including core, ai, provider adapters, introspect, postgres, prisma, studio, tui, and `pg`. | Environment variables choose which runtime paths are active. | Batteries-included product surface, not the smallest library install. |
| Terminal enrichment | `@askdb/tui` | Pulls `@askdb/core`, `@askdb/ai`, provider adapters, `@askdb/enrich`, Ink, and React. | `OPENAI_API_KEY` enables suggestions; manual authoring works without live suggestions. | Operates on Schema v2 files only. |
| Local browser Studio | `@askdb/studio` | Pulls core, ai, provider adapters, enrich, postgres, rag, and React UI dependencies. | `OPENAI_API_KEY` enables suggestions/sample generation; RAG provider choices are runtime config. | Local authoring UI, sample SQL checks, and local RAG exploration. |
| RAG with memory or file store | `@askdb/rag`, `@askdb/core` | `@askdb/rag` pulls `@askdb/core`. | Embedder packages only if using a helper such as OpenAI. | In-memory and file stores do not need `pg`. |
| RAG with pgvector | `@askdb/rag`, `@askdb/core` | `@askdb/rag` pulls `@askdb/core`. | `pg` when using the pgvector adapter with a Postgres connection; embedding provider package as needed. | Vector storage is optional and selected by the host. |

## Connectors vs peer packages

Connectors and peer packages solve different problems:

- A connector is an AskDB integration package that knows how to describe a schema source. Examples: `@askdb/postgres` and `@askdb/prisma`.
- A peer package is a runtime dependency the consumer installs only when the chosen feature needs it. Examples: `pg` for live Postgres catalog reads, `pg` for pgvector, and AI SDK provider packages for model or embedding helpers.
- Installing `@askdb/core` does not select a database. The caller chooses a dialect package for SQL generation and a connector package for schema introspection.
- Installing an authoring surface such as `@askdb/tui` or `@askdb/studio` does not make it a connector. Those surfaces edit Schema v2 artifacts.

## Extension points

| Extension point | Package | Shape | When to implement |
| --- | --- | --- | --- |
| SQL dialect | `@askdb/core` consumer API, implemented by integrations | `AskDialect` | Add a database dialect or a different SQL-generation/validation policy. |
| Introspection connector | `@askdb/introspect` contract, implemented by integrations | `Connector<TInput>` | Add a new schema metadata source such as another database engine, export format, or schema file type. |
| Catalog runner | Integration-owned helper, currently `@askdb/postgres` | `CatalogQueryRunner` | Use a different live database client while keeping the connector unchanged. |
| Enrichment authoring | `@askdb/enrich` | `Workspace`, draft builders, save helpers, bundle helpers | Build a custom UI over Schema v2 without depending on TUI or Studio. |
| Retrieval | `@askdb/rag` and `@askdb/core` | `Embedder`, `VectorStore`, `Retriever` | Use a different embedding provider, vector database, or retrieval policy. |
| Product surface | App packages or consumer app | CLI, HTTP, browser UI, MCP, future SDK | Compose the reusable packages into a workflow with host-owned auth, policy, and execution. |

## Related docs

- [Installable package guide](integration/installable-package.md)
- [Connector authoring](integration/connectors.md)
- [Schema v2 contract](contracts/schema-v2.md)
- [Modes and sensitive fields](contracts/sensitive-fields-and-modes.md)
- [ADR 0002: Integration-package layout](adrs/0002-integration-package-layout.md)
- [ADR 0004: Enrichment-package boundary](adrs/0004-enrichment-package-boundary.md)
