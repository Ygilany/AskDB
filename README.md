<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/brand/logo.png">
  <img alt="AskDB - Ask your data." src="docs/assets/brand/logo.png" width="420">
</picture>

# AskDB

**AskDB is a developer toolkit for adding natural-language analytics to your application.** It turns user questions into validated SQL using a human-enriched schema artifact. It gives developers library, CLI, and HTTP surfaces while keeping database execution, permissions, and audit logging inside the host application.

> **Ask your data. Keep control of the query.**

## Quickstart

For local development, use Node **20+**, pnpm **11**, and Docker if you want the Pagila sample database.

```bash
pnpm install
pnpm exec askdb init
# create .env with keys from askdb.config.ts header comments (optional); adjust env("...") names as needed
pnpm build
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many orders are there?"
```

AskDB uses a **schema artifact**: either a directory such as `fixtures/schemas/orders-users.schema/`, a bundled JSON file, or a direct `schema.json`. To create that artifact from a real Postgres database, use the introspection package:

```bash
pnpm exec askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
pnpm exec askdb ask --schema my-app.schema --question "Which tables look active?"
```

The detailed first-run paths live in [`packages/introspect/README.md`](packages/introspect/README.md) and [`docs/integration/installable-package.md`](docs/integration/installable-package.md).

## Use as a library

```bash
pnpm add @askdb/core
pnpm add @askdb/postgres
# Example provider for the code below
pnpm add ai @ai-sdk/openai
```

`pg` is optional and only needed for live Postgres introspection through `@askdb/postgres`.

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import { createOpenAI } from "@ai-sdk/openai";

const schema = loadSchema("./my-app.schema");
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { sql } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: openai("gpt-4o-mini"),
  dialect: postgresDialect,
});
```

Per-provider model recipes (OpenAI, Anthropic, Bedrock, Ollama, AI Gateway) and introspection recipes live in [`docs/integration/installable-package.md`](docs/integration/installable-package.md).

## Constitution

Product direction and technical baseline live in **`docs/`**:

- [`docs/mission.md`](docs/mission.md) — north star, principles, non-goals  
- [`docs/architecture.md`](docs/architecture.md) — package boundaries, diagrams, install profiles, connectors vs. optional peers
- [`docs/platform.md`](docs/platform.md) — languages, monorepo shape, Postgres-first  
- [`docs/roadmap.md`](docs/roadmap.md) — phased implementation order  
- [`docs/specs/phase-2-hardening-modes/README.md`](docs/specs/phase-2-hardening-modes/README.md) — **Phase 2** spec hub (links plan, requirements, validation merge bar)  
- [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md) — operating modes (`schema_only`, `bounded_results`)  
- [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md) — sensitive schema markers vs. models, bounded summaries  
- [`docs/integration/reuse-core-phase-3.md`](docs/integration/reuse-core-phase-3.md) — stable `@askdb/core` entrypoints for wrappers (MCP/HTTP)  
- [`docs/integration/installable-package.md`](docs/integration/installable-package.md) — install + BYO model + introspection workflow recipes
- [`docs/specs/phase-6-introspection/README.md`](docs/specs/phase-6-introspection/README.md) — **Phase 6** introspection spec hub  
- [`docs/specs/phase-1-schema-sql-cli/requirements.md`](docs/specs/phase-1-schema-sql-cli/requirements.md) — Phase 1 scope (implemented in this repo)  
- Structured logging rationale: [`docs/adrs/0001-structured-logging-pino.md`](docs/adrs/0001-structured-logging-pino.md)  
- Env / `askdb.config` bootstrap: [`docs/adrs/0005-askdb-config-and-env-bootstrap.md`](docs/adrs/0005-askdb-config-and-env-bootstrap.md)  

## Development

**Stack:** pnpm workspace + **Turborepo**, TypeScript, and focused packages/apps:

- [`packages/core`](packages/core) — NL→SQL library and schema artifact loader.
- [`packages/introspect`](packages/introspect) — Postgres-first schema introspection.
- [`packages/postgres`](packages/postgres) — Postgres dialect, connector, templates, and catalog runner.
- [`packages/rag`](packages/rag) — schema artifact chunking, indexing, and retrieval helpers.
- [`packages/enrich`](packages/enrich) — shared schema artifact enrichment workspace helpers.
- [`apps/cli`](apps/cli) — binary `askdb`, including the `askdb introspect` shim.
- [`apps/http-api`](apps/http-api) — HTTP wrapper over core.
- [`apps/studio`](apps/studio) — local browser UI for enrichment and sample NL-to-SQL checks.

```bash
pnpm install
pnpm build    # turbo run build
pnpm test     # turbo run test (integration runs when DATABASE_URL is set)
pnpm lint     # turbo run lint (TypeScript noEmit)
```

Before opening or updating a PR, run the release-style checks:

```bash
pnpm smoke:install
pnpm preflight
```

Public release steps are tracked in [`docs/release.md`](docs/release.md).

**Pagila dev fixture** — optional PostgreSQL loaded with the [Pagila](https://github.com/devrimgunduz/pagila) sample database ([`fixtures/pagila/README.md`](fixtures/pagila/README.md)):

```bash
pnpm pagila:up        # docker compose up --build -d (PostgreSQL on localhost:5433)
pnpm pagila:logs      # follow container logs
pnpm pagila:down      # stop and remove containers (keeps volume)
pnpm pagila:reset     # down and delete volume — next `pagila:up` re-imports Pagila
```

Equivalent without pnpm:

```bash
docker compose -f fixtures/pagila/docker-compose.yml up --build -d
```

Then point AskDB at it:

```bash
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/pagila"
```

**Schema artifacts** — see [`docs/contracts/schema-v2.md`](docs/contracts/schema-v2.md), [`fixtures/schemas/README.md`](fixtures/schemas/README.md), and the sample [`fixtures/schemas/orders-users.schema/`](fixtures/schemas/orders-users.schema). A schema artifact can be hand-authored, bundled as JSON, or produced from Postgres with `@askdb/introspect`. Optional **`sensitive`** markers tag columns/tables in NL→SQL DDL by default (`(sensitive)`); use **`--omit-sensitive-from-prompt`** or **`ASKDB_OMIT_SENSITIVE_FROM_PROMPT`** to withhold names instead. Policy for modes and summaries is in [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md).

**Environment variables**

See [`.env.example`](.env.example) for a copy/paste template. Keep real secrets in a local **`.env`** (gitignored); the CLI **loads `.env` automatically** and then reads `process.env`.

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for NL→SQL (BYO; OpenAI-compatible). |
| `OPENAI_BASE_URL` | Optional custom base URL for OpenAI-compatible APIs. |
| `ASKDB_MODEL` or `OPENAI_MODEL` | Optional model id (default `gpt-4o-mini`). |
| `DATABASE_URL` | Optional; commonly passed to `askdb introspect --url` for live Postgres introspection. |
| `ASKDB_LOG_LEVEL` | Optional structured log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` (default: `silent` unless `--verbose`, `--log-file`, or `--log-stdout` implies `info`). |
| `ASKDB_CORRELATION_ID` | Optional; override the correlation id emitted on every JSON log line for the run. |
| `ASKDB_MODE` | Optional operating mode (`schema_only` \| `bounded_results`); default `schema_only`. Formal contract: [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md). |
| `ASKDB_OMIT_SENSITIVE_FROM_PROMPT` | When `true`/`1`/`yes`, omit sensitive column/table names from NL→SQL DDL (default is to **include** names, tagged `(sensitive)`). See [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md). |

**Structured logging (Phase 2)** — JSON lines via [Pino](https://github.com/pinojs/pino); diagnostics go to **stderr** by default so **stdout** stays free for SQL. Flags:

| Flag | Purpose |
|------|---------|
| `-v` / `--verbose` | Sets log level to `info` (stderr). |
| `--log-level <level>` | Explicit level (overrides `ASKDB_LOG_LEVEL`). |
| `--log-file <path>` | Append the same JSON logs to a file (sync writes; parent dirs created). Implies `info` if level was `silent`. |
| `--log-stdout` | Mirror structured logs to stdout. Implies `info` if level was `silent`. |
| `--correlation-id <id>` | Override correlation id (else random UUID per run). |
| `--explain` | After `-- sql --`, print `-- explain --` plus JSON describing heuristic guardrails satisfied (`statementKind`, `checksVerified`, `remediationNote`). |
| `--omit-sensitive-from-prompt` | Omit sensitive identifiers from NL→SQL DDL (default: include names with `(sensitive)` tag). Overrides default when combined with `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`. |
| `--mode <id>` | Operating mode: `schema_only` (default) or `bounded_results`. Current AskDB surfaces return SQL only. |

**Modes + structured logs (Phase 2)** — same `ask` subcommand; pass `--mode` or set `ASKDB_MODE`. Use `-v` / `--log-file` so JSON events, including `askdb.pipeline.mode`, appear on **stderr** or in a file — see [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md).

```bash
pnpm build
# Generate only — logs on stderr include askdb.pipeline.mode (default schema_only unless you pass --mode)
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many orders?" \
  --mode schema_only \
  -v

```

**CLI example** (generate SQL only):

```bash
pnpm build
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many orders are there?"
```

AskDB returns SQL for review; it does not execute generated SQL. Treat generated SQL as an artifact that must be approved and run under your own database roles, read-only controls, tenant policy, and audit logging.

**Engines:** PostgreSQL, MySQL, SQLite, and SQL Server are all first-class — install the matching `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, or `@askdb/sqlserver` adapter and pass the dialect to `ask()`. Postgres is the reference dialect; the others ship dialect and introspection with parity tracked on the roadmap.

**Current limitations (pre-1.0 / dev):** AskDB returns SQL only (execution stays in your app); SQL guardrails are heuristic (not a full SQL parser); a first-party MCP server, richer report generation, and a hosted dashboard are roadmap work. Merge bars: **[Phase 1](docs/specs/phase-1-schema-sql-cli/validation.md)** · **[Phase 2](docs/specs/phase-2-hardening-modes/validation.md)**.

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm install --frozen-lockfile`, `pnpm build`, starts the Pagila introspection fixture, runs `pnpm test`, runs the installable smoke test, and validates publish with a dry run.

## What it does

- **Natural language → validated SQL** grounded in your database schema, with SQL validation and guardrails.
- **Human-reviewed schema enrichment** — introspect your database, then enrich the schema artifact with descriptions, aliases, and business concepts using the TUI or Studio.
- **Clear execution boundary** — AskDB returns SQL; it does not execute against your database. Your application decides whether to show it, review it, approve it, run it, log it, or reject it.
- **Multiple surfaces** — the same schema artifact and generation pipeline across the CLI, a Node library, and an HTTP API.
- **Multi-tenancy** — define a tenant policy (roots, hierarchy, scoped/polymorphic/global tables) and pass a runtime tenant scope to `ask()`; AskDB injects tenant-filtering predicates into generated SQL automatically.

## Product notes

- **BYO API keys** — developers bring their own model credentials.
- **Schema as input** — describe your schema in a supported format; later support multiple formats and retrieval (e.g. RAG) over schema/metadata.
- **Clarification** — prompt or surface follow-ups when intent or schema context is unclear.
- **Sensitive fields** — schema artifacts can mark tables/columns; NL→SQL prompts **list** identifiers by default (tagged) with an optional **omit** mode ([`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md)); RAG paths remain policy-controlled by mode/host.
- **Multi-tenant** — questions can target a tenant; **query scope must respect tenant boundaries** when the deployment requires it.

## Modes (trust boundaries)

How much of the **schema context** the model sees depends on the chosen mode:

1. **Schema only** — model proposes SQL from schema context only.
2. **Schema + report shape** — roadmap-only structured report template alongside generated SQL.
3. **Schema + bounded results** — reserved for hosts that may summarize approved result subsets outside the current AskDB surfaces.
4. **Full AI-assisted reporting** — roadmap-only richer AI-driven report generation where product rules allow.

**Engine v1 (CLI `@askdb/core`):** selectable modes **`schema_only`** and **`bounded_results`** are documented in [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md). Current AskDB surfaces still return SQL only.

## Status

Phases 1–10 are implemented on this branch: core, CLI, HTTP API, installable package seams, schema artifact format, Postgres introspection, TUI enrichment, RAG indexing and retrieval, Studio (React browser UI), and multi-tenancy proof. Later phases are in [`docs/roadmap.md`](docs/roadmap.md).

## Support

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/ygilany)
