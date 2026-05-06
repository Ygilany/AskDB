# AskDB

AskDB turns natural language into **schema-grounded SQL and reports** so you can ask questions about your data without writing SQL by hand.

## Constitution

Product direction and technical baseline live in **`docs/`**:

- [`docs/mission.md`](docs/mission.md) — north star, principles, non-goals  
- [`docs/platform.md`](docs/platform.md) — languages, monorepo shape, Postgres-first  
- [`docs/roadmap.md`](docs/roadmap.md) — phased implementation order  
- [`docs/specs/phase-2-hardening-modes/README.md`](docs/specs/phase-2-hardening-modes/README.md) — **Phase 2** spec hub (links plan, requirements, validation merge bar)  
- [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md) — operating modes (`schema_only`, `bounded_results`)  
- [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md) — sensitive schema markers vs. models, bounded summaries  
- [`docs/integration/reuse-core-phase-3.md`](docs/integration/reuse-core-phase-3.md) — stable `@askdb/core` entrypoints for wrappers (MCP/HTTP)  
- [`docs/specs/phase-1-schema-sql-cli/requirements.md`](docs/specs/phase-1-schema-sql-cli/requirements.md) — Phase 1 scope (implemented in this repo)  
- Structured logging rationale: [`docs/adrs/0001-structured-logging-pino.md`](docs/adrs/0001-structured-logging-pino.md)  

## Development

**Stack:** pnpm workspace + **Turborepo**, TypeScript, [`packages/core`](packages/core) (library) and [`packages/cli`](packages/cli) (binary `askdb`).

```bash
pnpm install
pnpm build    # turbo run build
pnpm test     # turbo run test (integration runs when DATABASE_URL is set)
pnpm lint     # turbo run lint (TypeScript noEmit)
```

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

**Phase 1 schema format** is **AskDB schema JSON v1** — see [`fixtures/schemas/README.md`](fixtures/schemas/README.md) and the sample [`fixtures/schemas/orders-users.schema.json`](fixtures/schemas/orders-users.schema.json). Optional **`sensitive`** markers (Phase 2) tag columns/tables in NL→SQL DDL by default (`(sensitive)`); use **`--omit-sensitive-from-prompt`** or **`ASKDB_OMIT_SENSITIVE_FROM_PROMPT`** to withhold names instead. Policy for modes and summaries is in [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md).

**Environment variables**

See [`.env.example`](.env.example) for a copy/paste template. Keep real secrets in a local **`.env`** (gitignored); the CLI **loads `.env` automatically** and then reads `process.env`.

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required for NL→SQL (BYO; OpenAI-compatible). |
| `OPENAI_BASE_URL` | Optional custom base URL for OpenAI-compatible APIs. |
| `ASKDB_MODEL` or `OPENAI_MODEL` | Optional model id (default `gpt-4o-mini`). |
| `DATABASE_URL` | Optional; required with `askdb ask --execute` to run generated SQL in a **read-only** Postgres transaction. |
| `ASKDB_LOG_LEVEL` | Optional structured log level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` (default: `silent` unless `--verbose`, `--log-file`, or `--log-stdout` implies `info`). |
| `ASKDB_CORRELATION_ID` | Optional; override the correlation id emitted on every JSON log line for the run. |
| `ASKDB_MODE` | Optional operating mode (`schema_only` \| `bounded_results`); default `schema_only`. Formal contract: [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md). |
| `ASKDB_OMIT_SENSITIVE_FROM_PROMPT` | When `true`/`1`/`yes`, omit sensitive column/table names from NL→SQL DDL (default is to **include** names, tagged `(sensitive)`). See [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md). |

**Structured logging (Phase 2)** — JSON lines via [Pino](https://github.com/pinojs/pino); diagnostics go to **stderr** by default so **stdout** stays free for SQL/results. Flags:

| Flag | Purpose |
|------|---------|
| `-v` / `--verbose` | Sets log level to `info` (stderr). |
| `--log-level <level>` | Explicit level (overrides `ASKDB_LOG_LEVEL`). |
| `--log-file <path>` | Append the same JSON logs to a file (sync writes; parent dirs created). Implies `info` if level was `silent`. |
| `--log-stdout` | Mirror structured logs to stdout. Implies `info` if level was `silent`. |
| `--correlation-id <id>` | Override correlation id (else random UUID per run). |
| `--explain` | After `-- sql --`, print `-- explain --` plus JSON describing heuristic guardrails satisfied (`statementKind`, `checksVerified`, `remediationNote`). |
| `--omit-sensitive-from-prompt` | Omit sensitive identifiers from NL→SQL DDL (default: include names with `(sensitive)` tag). Overrides default when combined with `ASKDB_OMIT_SENSITIVE_FROM_PROMPT`. |
| `--mode <id>` | Operating mode: `schema_only` (default) or `bounded_results`. With `--execute` and logging, post-execute branches differ (see contract doc). |

**Modes + structured logs (Phase 2)** — same `ask` subcommand; pass `--mode` or set `ASKDB_MODE`. Use `-v` / `--log-file` so JSON events (including `askdb.pipeline.mode` and, after `--execute`, `askdb.pipeline.post_execute`) appear on **stderr** or in a file — see [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md).

```bash
pnpm build
# Generate only — logs on stderr include askdb.pipeline.mode (default schema_only unless you pass --mode)
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema.json \
  --question "How many orders?" \
  --mode schema_only \
  -v

# With --execute: DATABASE_URL must reference a Postgres that actually has the tables in your schema file.
export DATABASE_URL="postgres://user:pass@localhost:5432/dbname"
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema.json \
  --question "List user emails" \
  --execute \
  --mode bounded_results \
  -v
```

After a successful `--execute`, check stderr for `askdb.pipeline.post_execute`: `branch: skipped` for `schema_only`, `branch: stub` for `bounded_results`. For local exploration with sample data only, [`pnpm pagila:up`](#pagila-dev-fixture) gives Pagila on port **5433** — pair it with a **schema JSON that describes those tables** when you NL→SQL + execute against it.

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

**Limitations (Phase 1 / dev):** single schema JSON format; Postgres execution only; SQL guardrails are heuristic (not a full SQL parser); no MCP/web yet. Merge bars: **[Phase 1](docs/specs/phase-1-schema-sql-cli/validation.md)** · **[Phase 2](docs/specs/phase-2-hardening-modes/validation.md)**.

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm test` with a Postgres service so integration tests exercise a real database.

## What it does

- **Natural language → SQL** grounded in your database schema (with validation and guardrails).
- **Execute** queries and return results; **reports** build on top of that pipeline.
- **Multiple surfaces** — same core idea across CLI, MCP, and web; web aims to be **embeddable** with a future SDK / component-style integration.

## Product notes

- **BYO API keys** — developers bring their own model credentials.
- **Schema as input** — describe your schema in a supported format; later support multiple formats and retrieval (e.g. RAG) over schema/metadata.
- **Clarification** — prompt or surface follow-ups when intent or schema context is unclear.
- **Sensitive fields** — schema JSON can mark tables/columns; NL→SQL prompts **list** identifiers by default (tagged) with an optional **omit** mode ([`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md)); row payloads and RAG paths remain policy-controlled by mode/host.
- **Multi-tenant** — questions can target a tenant; **query scope must respect tenant boundaries** when the deployment requires it.

## Modes (trust boundaries)

How much of the **data** (not just schema) the model sees depends on the chosen mode:

1. **Schema only** — model proposes SQL; results feed reporting **without** row data going back to the model.
2. **Schema + report shape** — same as (1), plus a structured report template alongside executed results.
3. **Schema + bounded results** — a subset of query results may go to the model for summaries; user retains control over what is shared.
4. **Full AI-assisted reporting** — richer AI-driven report generation where product rules allow.

**Engine v1 (CLI `@askdb/core`):** selectable modes **`schema_only`** and **`bounded_results`** are documented in [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md). Modes **(2)** and **(4)** above are roadmap-only until later phases.

## Status

Phase 1 CLI + core path is implemented; later phases are in [`docs/roadmap.md`](docs/roadmap.md).
