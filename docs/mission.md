# Mission

AskDB turns natural language into **schema-grounded SQL and reports** so teams can ask questions about their own data without becoming SQL experts.

## Target audience

- **Primary — builders and integrators** — Software engineers and platform teams who **embed or wire up** AskDB (CLI, MCP, HTTP API, future SDK, embeddable UI). They own schema supply, API keys, execution boundaries, and how “modes” and tenant rules are enforced in their stack.
- **Agents** — Autonomous or LLM-driven agents (coding assistants, workflow bots, internal tools) that invoke AskDB through **headless, machine-friendly surfaces**—especially **MCP** and **CLI** with stable inputs/outputs—so they can generate or validate SQL, run approved queries, and assemble reports under the same contracts as human integrators. **Accountability and policy** (what may execute, on which data, with which keys) remain with the team that deployed the agent.
- **Secondary — askers inside the product** — Analysts, product managers, operators, and similar roles who **use** natural-language query and reporting **through an app or dashboard** that already integrated AskDB. They benefit from plain-language questions and structured outputs without living in SQL; governance and data access remain defined by the integrating team.

## North star

We optimize for two things at once:

1. **Trust-first analytics** — Answers are anchored in the customer’s database schema and executed queries. Row-level data is treated as sensitive by default: the system prefers flows where the model reasons over schema (and optional bounded result subsets) rather than ingesting full datasets. When data must touch the model, it should be **explicit, bounded, and user-controlled**, aligned with the product’s “modes” (schema-only execution vs. summaries over approved result sets).

2. **Developer-first embed** — AskDB is built to be **plugged into projects** as an **installable npm package**: bring-your-own API keys, bring-your-own database connectivity, bring-your-own embedding provider, and bring-your-own vector store. The headless core (`@askdb/core`) plus optional companion packages (`@askdb/cli`, `@askdb/tui`, `@askdb/rag`) and a future SDK + embeddable UI (similar in spirit to Clerk or OpenRouter) let teams ship “ask your data” inside their own apps without rebuilding the pipeline.

## What success looks like

- A developer can install AskDB from npm, point it at their schema metadata and an LLM key, ask questions in plain language, and get **validated SQL** plus **reliable execution** and **clear reporting** on top of results — all from their own runtime.
- **Schema intelligence** — Raw technical schema (columns, types, keys) is not enough for great answers; AskDB turns it into a **describable schema** enriched with **business context** (what tables and fields *mean*), **aliases / synonyms** (how users *say* it), and an optional **concept dictionary** (shared domain terms). Authoring happens **headless-first** through an interactive **TUI** that AI-suggests descriptions and aliases and lets a human confirm; a future web catalog (later phase) is an alternative authoring surface, not a prerequisite.
- **RAG-friendly format** — The describable schema is stored in a format **designed for chunking and retrieval**: stable IDs per table/column/concept, structured metadata in YAML front-matter, prose (descriptions, “common query language”, example questions) in markdown body. This is the same artifact `@askdb/rag` chunks and embeds, and that NL→SQL prompt assembly grounds against — there is no separate “knowledge base”.
- **RAG is part of the package** — `@askdb/rag` ships **bring-your-own embedder** and **bring-your-own vector store** adapters with sensible defaults (in-memory, then file-backed, then pgvector); sensitive-field rules from the schema artifact propagate into chunking so flagged content is excluded from embeddings by default.
- **Flexible connectivity** — The AskDB application **does not always need a live connection** to the customer’s database instance. Teams can **import** schema artifacts (files or exported metadata) and work schema-first; a **direct DB attachment** remains optional when execution or sync is desired (see `platform.md`).
- **Schema introspection is first-class** — Generating a Schema v2 artifact from a real database is a supported capability, not an afterthought. AskDB ships **two equally-supported paths** that produce the **same** artifact: a **live** connection (executor-backed catalog reads, BYO connection details) and an **air-gapped** path (run documented SQL in `psql`/CI/IDE, hand the export bundle to AskDB). Both paths land in the same describable schema the TUI, RAG, and prompt assembly already read.
- **Multi-tenant** setups can enforce **non-negotiable tenant scoping** in generated and executed queries when the schema and policies support it.
- Operators can mark **sensitive fields** so they are excluded from indexing/RAG and from prompts where applicable.
- **Longer term:** AskDB supports **multiple database engines**, not only Postgres—each new engine is added deliberately (dialect, driver, validation) so quality stays high (see `roadmap.md`).

## Non-goals (for now)

- Owning the customer’s database or credentials centrally.
- Training proprietary models on customer data.
- Guaranteeing domain-specific business correctness without human review of critical queries—users remain accountable for production queries and access control.

## Principles

- **Schema is the contract** — Ingest, normalize, and search schema descriptions so generation stays grounded.
- **Enrichment beats bare DDL** — Prefer an explicit pipeline from **pure schema structure** → **describable, context-rich schema** (AI-assisted gap detection + human confirmation through TUI, web UI, or prompts).
- **Headless-first, then UI** — Every authoring and querying capability is reachable from a headless surface (library, CLI, TUI) before a graphical surface depends on it. UIs are alternatives, not prerequisites.
- **BYO everything that touches secrets** — API keys (chat + embeddings), database connectivity, and vector store choice all stay on the customer side. The package ships adapters and defaults; the integrator owns the keys and the data path.
- **Pluggable adapters at every external seam** — LLM provider, database executor, embedding provider, and vector store are interchangeable behind small interfaces. Swapping any one of them does not require forking AskDB.
- **Installable contract** — `@askdb/core` is published to npm with a documented, semver-stable surface. Wrappers (CLI, TUI, RAG, HTTP, MCP, future SDK) depend on it as consumers, not co-located private code.
- **Progressive disclosure** — Start with one schema format and **Postgres as the reference engine**; add **other databases in a dedicated later phase** (adapters, dialect-aware SQL, execution) once the Postgres path is proven.
- **Same core, many surfaces** — CLI, TUI, HTTP, MCP, and web share one engine so behavior stays consistent.
