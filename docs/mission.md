# Mission

AskDB turns natural language into **schema-grounded SQL and reports** so teams can ask questions about their own data without becoming SQL experts.

## Target audience

- **Primary — builders and integrators** — Software engineers and platform teams who **embed or wire up** AskDB (CLI, MCP, HTTP API, future SDK, embeddable UI). They own schema supply, API keys, execution boundaries, and how “modes” and tenant rules are enforced in their stack.
- **Secondary — askers inside the product** — Analysts, product managers, operators, and similar roles who **use** natural-language query and reporting **through an app or dashboard** that already integrated AskDB. They benefit from plain-language questions and structured outputs without living in SQL; governance and data access remain defined by the integrating team.

## North star

We optimize for two things at once:

1. **Trust-first analytics** — Answers are anchored in the customer’s database schema and executed queries. Row-level data is treated as sensitive by default: the system prefers flows where the model reasons over schema (and optional bounded result subsets) rather than ingesting full datasets. When data must touch the model, it should be **explicit, bounded, and user-controlled**, aligned with the product’s “modes” (schema-only execution vs. summaries over approved result sets).

2. **Developer-first embed** — AskDB is built to be **plugged into projects**: bring-your-own API keys, bring-your-own database connectivity, and eventually an **SDK + embeddable UI** pattern (similar in spirit to Clerk or OpenRouter) so teams can ship “ask your data” inside their own apps without rebuilding the pipeline.

## What success looks like

- A developer can connect AskDB to their database metadata, ask questions in plain language, and get **validated SQL** plus **reliable execution** and **clear reporting** on top of results.
- **Schema intelligence** — Raw technical schema (columns, types, keys) is not enough for great answers; AskDB turns it into a **describable schema** enriched with **business context** (what tables and fields *mean*). Where context is missing or ambiguous, the **model prompts the user**; the product also offers a **structured UI** to review tables and fields and supply that context so it can be **saved and reused** for future generation.
- **Flexible connectivity** — The AskDB application **does not always need a live connection** to the customer’s database instance. Teams can **import** schema artifacts (files or exported metadata) and work schema-first; a **direct DB attachment** remains optional when execution or sync is desired (see `platform.md`).
- **Multi-tenant** setups can enforce **non-negotiable tenant scoping** in generated and executed queries when the schema and policies support it.
- Operators can mark **sensitive fields** so they are excluded from indexing/RAG and from prompts where applicable.
- **Longer term:** AskDB supports **multiple database engines**, not only Postgres—each new engine is added deliberately (dialect, driver, validation) so quality stays high (see `roadmap.md`).

## Non-goals (for now)

- Owning the customer’s database or credentials centrally.
- Training proprietary models on customer data.
- Guaranteeing domain-specific business correctness without human review of critical queries—users remain accountable for production queries and access control.

## Principles

- **Schema is the contract** — Ingest, normalize, and search schema descriptions so generation stays grounded.
- **Enrichment beats bare DDL** — Prefer an explicit pipeline from **pure schema structure** → **describable, context-rich schema** (AI-assisted gap detection + human confirmation through UI or prompts).
- **BYO everything that touches secrets** — API keys and connection details stay on the customer side when they choose live execution paths.
- **Progressive disclosure** — Start with one schema format and **Postgres as the reference engine**; add **other databases in a dedicated later phase** (adapters, dialect-aware SQL, execution) once the Postgres path is proven.
- **Same core, many surfaces** — CLI, MCP, and web should share one engine so behavior stays consistent.
