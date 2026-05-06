# AskDB

AskDB turns natural language into **schema-grounded SQL and reports** so you can ask questions about your data without writing SQL by hand.

## Constitution

Product direction and technical baseline live in **`docs/`**:

- [`docs/mission.md`](docs/mission.md) — north star, principles, non-goals  
- [`docs/platform.md`](docs/platform.md) — languages, monorepo shape, Postgres-first  
- [`docs/roadmap.md`](docs/roadmap.md) — phased implementation order  

## What it does

- **Natural language → SQL** grounded in your database schema (with validation and guardrails).
- **Execute** queries and return results; **reports** build on top of that pipeline.
- **Multiple surfaces** — same core idea across CLI, MCP, and web; web aims to be **embeddable** with a future SDK / component-style integration.

## Product notes

- **BYO API keys** — developers bring their own model credentials.
- **Schema as input** — describe your schema in a supported format; later support multiple formats and retrieval (e.g. RAG) over schema/metadata.
- **Clarification** — prompt or surface follow-ups when intent or schema context is unclear.
- **Sensitive fields** — allow marking fields so they stay out of retrieval and LLM context where applicable.
- **Multi-tenant** — questions can target a tenant; **query scope must respect tenant boundaries** when the deployment requires it.

## Modes (trust boundaries)

How much of the **data** (not just schema) the model sees depends on the chosen mode:

1. **Schema only** — model proposes SQL; results feed reporting **without** row data going back to the model.
2. **Schema + report shape** — same as (1), plus a structured report template alongside executed results.
3. **Schema + bounded results** — a subset of query results may go to the model for summaries; user retains control over what is shared.
4. **Full AI-assisted reporting** — richer AI-driven report generation where product rules allow.

## Status

Early-stage; see **`docs/roadmap.md`** for the current planned phases.
