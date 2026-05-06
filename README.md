# AskDB

AskDB turns natural language into **schema-grounded SQL and reports** so you can ask questions about your data without writing SQL by hand.

## Constitution

Product direction and technical baseline live in **`docs/`**:

- [`docs/mission.md`](docs/mission.md) — north star, principles, non-goals  
- [`docs/platform.md`](docs/platform.md) — languages, monorepo shape, Postgres-first  
- [`docs/roadmap.md`](docs/roadmap.md) — phased implementation order  
- [`docs/specs/phase-1-schema-sql-cli/requirements.md`](docs/specs/phase-1-schema-sql-cli/requirements.md) — Phase 1 scope (implemented in this repo)  

## Development (Phase 1)

**Stack:** pnpm workspace + **Turborepo**, TypeScript, [`packages/core`](packages/core) (library) and [`packages/cli`](packages/cli) (binary `askdb`).

```bash
pnpm install
pnpm build    # turbo run build
pnpm test     # turbo run test (integration runs when DATABASE_URL is set)
pnpm lint     # turbo run lint (TypeScript noEmit)
```

**Phase 1 schema format** is **AskDB schema JSON v1** — see [`fixtures/schemas/README.md`](fixtures/schemas/README.md) and the sample [`fixtures/schemas/orders-users.schema.json`](fixtures/schemas/orders-users.schema.json).

**Environment variables**

See [`.env.example`](.env.example) for a copy/paste template. Keep real secrets in a local **`.env`** (gitignored); the CLI **loads `.env` automatically** and then reads `process.env`.

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for NL→SQL (BYO; OpenAI-compatible). |
| `OPENAI_BASE_URL` | Optional custom base URL for OpenAI-compatible APIs. |
| `ASKDB_MODEL` or `OPENAI_MODEL` | Optional model id (default `gpt-4o-mini`). |
| `DATABASE_URL` | Optional; required with `askdb ask --execute` to run generated SQL in a **read-only** Postgres transaction. |

**CLI example** (generate SQL only):

```bash
pnpm build
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema.json \
  --question "How many orders are there?"
```

With execution (Postgres must be reachable):

```bash
export DATABASE_URL="postgres://user:pass@localhost:5432/dbname"
pnpm build
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema.json \
  --question "List user emails" \
  --execute
```

Use `--json` with `--execute` for JSON rows instead of TSV.

**Limitations (Phase 1 / dev):** single schema JSON format; Postgres execution only; SQL guardrails are heuristic (not a full SQL parser); no MCP/web yet. See [`docs/specs/phase-1-schema-sql-cli/validation.md`](docs/specs/phase-1-schema-sql-cli/validation.md) for merge criteria.

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test` with a Postgres service so integration tests exercise a real database.

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

Phase 1 CLI + core path is implemented; later phases are in [`docs/roadmap.md`](docs/roadmap.md).
