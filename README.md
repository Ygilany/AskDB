<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/brand/logo.png">
  <img alt="AskDB - Ask your data." src="docs/assets/brand/logo.png" width="420">
</picture>

# AskDB

**AskDB is an open-source NL-to-SQL toolkit for developers: it uses your LLM to generate checked, schema-grounded SQL, then hands it back to your app to review and run.** BYO model, BYO database, BYO vector store.

AskDB grounds generation in a human-enriched schema artifact, and it keeps database execution, permissions, tenant policy, and audit logging inside the host application. Library, CLI, Studio, and HTTP surfaces share the same core pipeline.

> **Ask your data. Keep control of the query.**
>
> **Status:** release candidate for 1.0. Every published package ships `-rc.N` prerelease versions on npm: the 12 packages listed under **At 1.0** share one version on the `1.0.0-rc` line, and Studio, `@askdb/enrich` and `@askdb/rag` are on `0.2.0-rc`. The public API of the 1.0 packages is frozen; the release candidates fix bugs before 1.0.0.
>
> **At 1.0:** `@askdb/core`, `@askdb/client`, `@askdb/config`, `@askdb/ai`, `askdb`, `@askdb/http-api`, `@askdb/introspect` and the engine packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`) go to 1.0.0. Studio, `@askdb/enrich` and `@askdb/rag` stay `0.x`, and their APIs may still move. 1.0 promises checked SQL for PostgreSQL, MySQL, MariaDB, SQLite and SQL Server; reports, result summaries and an MCP server come after 1.0 (see the [roadmap](docs/roadmap.md)).
>
> AskDB returns SQL for review; the library, CLI, and HTTP API never execute it (Studio's optional Playground **Execute** is a local development tool). AskDB's SQL checks are heuristic defense in depth, not a security boundary. Run generated SQL under a read-only, least-privilege database role. See [Run generated SQL safely](https://askdb.tools/concepts/safety-boundaries/#run-generated-sql-safely).

## Why AskDB exists

NL-to-SQL isn't a new problem. Systems that answer English questions from a database go back to BASEBALL (1961) and LUNAR (1971), and studies of large language models such as OpenAI's Codex writing SQL began in early 2022. The hard part in production isn't the LLM call. It's everything around it: capturing the business context behind your schema, getting the right enrichment into the prompt, wiring up RAG when the schema is too big to fit, and repeating that work for every new project. AskDB is the toolkit for *that* part.

## Quickstart

For a new project, use Node **22.23.4+**, a database or schema source, and an API key from your model provider.

```bash
npx askdb@latest init
# create .env with the model/database keys referenced by askdb.config.ts
npx askdb@latest introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
npx askdb@latest ask --schema my-app.schema --question "Which tables look active?"
```

Use `npx askdb@latest studio --schema my-app.schema` when you want the local browser UI for schema enrichment and sample NL-to-SQL checks.

AskDB uses a **schema artifact**: either a directory such as `my-app.schema/`, a bundled JSON file, or a direct `schema.json`. To create that artifact from a real database, use introspection:

```bash
npx askdb@latest introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
npx askdb@latest ask --schema my-app.schema --question "Which tables look active?"
```

The detailed first-run paths live in the [docs-site quickstart](https://askdb.tools/quickstart/), [`packages/introspect/README.md`](packages/introspect/README.md), and [`docs/integration/installable-package.md`](docs/integration/installable-package.md).

## Use as a library

```bash
# `ai` (Vercel AI SDK 6 or 7) is a required peer dependency — your app owns its version
pnpm add @askdb/core ai
# Example provider for the code below
pnpm add @ai-sdk/openai
```

The built-in dialects ship in `@askdb/core`, so SQL generation needs no engine package. Add `@askdb/postgres` only to introspect Postgres, live or offline from an export; its optional `pg` peer is needed only for live introspection.

```ts
import { ask, loadSchema } from "@askdb/core";
import { createOpenAI } from "@ai-sdk/openai";

const schema = loadSchema("./my-app.schema");
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { sql } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: openai("gpt-4o-mini"),
  dialect: "postgres",
});
```

Or, when `askdb.config.ts` should own the provider and model, build the model from it with `@askdb/ai`, and share it with your app's own AI SDK calls:

```ts
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { createAiRegistry } from "@askdb/ai";
import { generateText } from "ai";

bootstrapAskDbEnv({ cwd: process.cwd() });
const ai = createAiRegistry(); // the provider and model come from ai.language in askdb.config.ts
const model = await ai.createLanguageModelFromSection(getAskDbRuntimeConfig().ai.language);
if (!model) throw new Error(ai.keyMissingMessage("my-app"));

const { sql } = await ask({ question: "How many users signed up last week?", schema, model, dialect: "postgres" });
const { text } = await generateText({ model, prompt: `Explain this SQL in one sentence: ${sql}` });
```

This path also needs `@askdb/ai` and `@askdb/config`, next to the `@askdb/core`, `ai` and provider SDK installed above. [`@askdb/client`](packages/client/README.md)'s `createAskDb()` does the same setup and also resolves the schema and dialect from config.

Per-provider model recipes (OpenAI, Azure OpenAI / Foundry, Google Gemini, and Anthropic) and introspection recipes live in [`docs/integration/installable-package.md`](docs/integration/installable-package.md).

## Constitution

Product direction and technical baseline live in **`docs/`**:

- [`docs/mission.md`](docs/mission.md) — north star, principles, non-goals  
- [`docs/architecture.md`](docs/architecture.md) — package boundaries, diagrams, install profiles, connectors vs. optional peers
- [`docs/platform.md`](docs/platform.md) — languages, monorepo shape, published packages, supported engines  
- [`docs/roadmap.md`](docs/roadmap.md) — phased implementation order  
- [`docs/specs/`](docs/specs) — per-feature specs with status (core pipeline, schema format, modes and observability, introspection, RAG, Studio, HTTP API, multi-tenancy, distribution)  
- [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md) — operating modes (`schema_only`, `bounded_results`)  
- [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md) — sensitive schema markers vs. models, bounded summaries  
- [`docs/integration/reuse-core-phase-3.md`](docs/integration/reuse-core-phase-3.md) — stable `@askdb/core` entrypoints for wrappers (MCP/HTTP)  
- [`docs/integration/installable-package.md`](docs/integration/installable-package.md) — install + BYO model + introspection workflow recipes
- [`docs/specs/introspection.md`](docs/specs/introspection.md) — schema introspection spec  
- [`docs/specs/core-pipeline.md`](docs/specs/core-pipeline.md) — core NL→SQL pipeline and CLI spec  
- Structured logging rationale: [`docs/adrs/0001-structured-logging-pino.md`](docs/adrs/0001-structured-logging-pino.md)  
- Env / `askdb.config` bootstrap: [`docs/adrs/0005-askdb-config-and-env-bootstrap.md`](docs/adrs/0005-askdb-config-and-env-bootstrap.md)  

## Development

**Stack:** pnpm workspace + **Turborepo**, TypeScript, and focused packages/apps:

- [`packages/core`](packages/core) (`@askdb/core`) — NL→SQL pipeline (`ask()`), the built-in dialect specs, and the schema artifact loader.
- [`packages/ai`](packages/ai) (`@askdb/ai`) — AI provider registry and shared config helpers for AI SDK language and embedding models.
- [`packages/client`](packages/client) (`@askdb/client`) — config-aware facade (`createAskDb`) that resolves schema, model, and dialect from config.
- [`packages/config`](packages/config) (`@askdb/config`) — `defineConfig`, `env()`, and `askdb.config.*` discovery/bootstrap.
- [`packages/introspect`](packages/introspect) (`@askdb/introspect`) — connector contract, connector registry, `@askdb/introspect/kit` engine helpers, schema artifact renderer.
- [`packages/postgres`](packages/postgres) (`@askdb/postgres`) — Postgres introspection connector, catalog templates, `pg`-backed runner, and a re-export of core's Postgres dialect.
- [`packages/mysql`](packages/mysql) (`@askdb/mysql`) — MySQL introspection connector and `mysql2`-backed catalog runner.
- [`packages/sqlite`](packages/sqlite) (`@askdb/sqlite`) — SQLite introspection connector and `better-sqlite3`-backed catalog runner.
- [`packages/sqlserver`](packages/sqlserver) (`@askdb/sqlserver`) — SQL Server introspection connector and `mssql`-backed catalog runner.
- [`packages/prisma`](packages/prisma) (`@askdb/prisma`) — schema-file introspection connector for Prisma schemas.
- [`packages/rag`](packages/rag) (`@askdb/rag`) — schema artifact chunking, BYO embedder + vector store, and retrieval for `ask()`.
- [`packages/enrich`](packages/enrich) (`@askdb/enrich`) — schema artifact enrichment workspace helpers used by Studio.
- [`apps/cli`](apps/cli) (`askdb`) — binary `askdb`: `init`, `introspect`, `ask`, `studio`, `bundle`.
- [`apps/http-api`](apps/http-api) — HTTP wrapper over core.
- [`apps/studio`](apps/studio) — local browser UI for enrichment and sample NL-to-SQL checks.

```bash
pnpm install
pnpm build    # turbo run build — builds the `askdb` binary used below
# The repo root already ships askdb.config.ts. Optionally create .env with the keys it references
# (e.g. OPENAI_API_KEY), or set ASKDB_MOCK_SQL to skip live model calls.
pnpm exec askdb ask \
  --schema fixtures/schemas/orders-users.schema \
  --question "How many orders are there?"
pnpm test     # turbo run test (integration runs when DATABASE_URL is set)
pnpm lint     # turbo run lint (TypeScript noEmit)
```

Before opening or updating a PR, run the release-style checks:

```bash
pnpm smoke:install
pnpm preflight
```

Public release steps are tracked in [`docs/release.md`](docs/release.md).

**Multi-engine dev fixture** — the same logical schema and data in PostgreSQL, MySQL, MariaDB, SQL Server and SQLite ([`fixtures/multi-engine/README.md`](fixtures/multi-engine/README.md)):

```bash
pnpm fixture:up       # start the containers, wait for health, seed (idempotent)
pnpm fixture:down     # stop the containers (keeps volumes)
pnpm fixture:reset    # delete volumes and the SQLite file, then fixture:up
```

Then point AskDB at one of them, for example:

```bash
npx askdb introspect --engine postgres --schemas org,people,billing,ref \
  --url "postgres://fixture_reader:fixture_reader@127.0.0.1:15432/askdb_fixture"
```

**Schema artifacts** — see [`docs/contracts/schema-v2.md`](docs/contracts/schema-v2.md), [`fixtures/schemas/README.md`](fixtures/schemas/README.md), and the sample [`fixtures/schemas/orders-users.schema/`](fixtures/schemas/orders-users.schema). A schema artifact can be hand-authored, bundled as JSON, or produced from Postgres with `@askdb/introspect`. Optional **`sensitive`** markers tag columns/tables in NL→SQL DDL by default (`(sensitive)`); use **`--omit-sensitive-from-prompt`** or config **`modes.omitSensitiveFromPrompt: true`** to withhold names instead. Policy for modes and summaries is in [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md).

**Environment variables**

AskDB reads its settings from `askdb.config.ts`, not from the environment. The repo-root config reads the variables below with `env("…")`, so put them in a local **`.env`** (gitignored; [`.env.example`](.env.example) is a template). The CLI loads `.env` before it evaluates the config. The only AskDB variable read straight from the environment is `ASKDB_DEBUG`.

| Variable | Config key it fills | Purpose |
|----------|---------------------|---------|
| `OPENAI_API_KEY` | `ai.providerConfig.openai.apiKey` | Needed for live NL→SQL (BYO; OpenAI-compatible). |
| `OPENAI_MODEL` | `ai.language.model` | Optional model id (default `gpt-4o-mini`). |
| `DATABASE_URL` | `introspection.providerConfig.postgres.databaseUrl`, `studio.execute.databaseUrl` | Optional; the Postgres URL for `askdb introspect` and Studio's Execute. |
| `ASKDB_MOCK_SQL` | `dev.mockSql` | Optional; fixed SQL instead of a model call, for tests and local runs. |
| `ASKDB_CORRELATION_ID` | `logging.correlationId` | Optional; the correlation id on every JSON log line for the run. |
| `ASKDB_DEBUG` | none (read from the shell) | `1` or `true` prints stack traces. |

`OPENAI_BASE_URL` points the OpenAI SDK at another OpenAI-compatible endpoint; the SDK reads it itself. The config reads a few more for RAG and Studio (`ASKDB_RAG_EMBEDDER_MODEL`, `ASKDB_PGVECTOR_URL`, `ASKDB_STUDIO_HOST`, `ASKDB_STUDIO_PORT`); see its `env("…")` calls. Set the log level with `logging.level` and the operating mode with `modes.askdbMode` in `askdb.config.ts` (formal contract: [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md)).

**Structured logging (Phase 2)** — JSON lines via [Pino](https://github.com/pinojs/pino); diagnostics go to **stderr** by default so **stdout** stays free for SQL. Flags:

| Flag | Purpose |
|------|---------|
| `-v` / `--verbose` | Sets log level to `info` (stderr). |
| `--log-level <level>` | Explicit level: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent` (overrides `logging.level`; default `silent` unless `--verbose`, `--log-file` or `--log-stdout` implies `info`). |
| `--log-file <path>` | Append the same JSON logs to a file (sync writes; parent dirs created). Implies `info` if level was `silent`. |
| `--log-stdout` | Mirror structured logs to stdout. Implies `info` if level was `silent`. |
| `--correlation-id <id>` | Override correlation id (else random UUID per run). |
| `--explain` | After `-- sql --`, print `-- explain --` plus JSON describing heuristic guardrails satisfied (`statementKind`, `checksVerified`, `remediationNote`). |
| `--omit-sensitive-from-prompt` | Omit sensitive identifiers from NL→SQL DDL (default: include names with `(sensitive)` tag). To omit on every run, set `modes.omitSensitiveFromPrompt: true` in `askdb.config.ts` instead. See [`docs/contracts/sensitive-fields-and-modes.md`](docs/contracts/sensitive-fields-and-modes.md). |
| `--mode <id>` | Operating mode: `schema_only` or `bounded_results`. It can only tighten config `modes.askdbMode` (default `schema_only`), never loosen it. Current AskDB surfaces return SQL only. |

**Modes + structured logs (Phase 2)** — same `ask` subcommand; set `modes.askdbMode` in `askdb.config.ts`, and pass `--mode schema_only` to tighten it for one run. Use `-v` / `--log-file` so JSON events, including `askdb.pipeline.mode`, appear on **stderr** or in a file — see [`docs/contracts/modes-v1.md`](docs/contracts/modes-v1.md).

```bash
pnpm build
# Generate only — logs on stderr include askdb.pipeline.mode (config modes.askdbMode, default schema_only; --mode can only tighten it)
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

AskDB returns SQL for review; it does not execute generated SQL. Treat generated SQL as untrusted: approve it and run it under your own least-privilege, read-only database roles, database-enforced tenant isolation (for example Postgres row-level security), statement timeouts, and audit logging. See [Run generated SQL safely](https://askdb.tools/concepts/safety-boundaries/#run-generated-sql-safely) and [SECURITY.md](SECURITY.md#security-model).

**Engines:** the 1.0 support claim covers five engine families: PostgreSQL, MySQL, MariaDB, SQLite and SQL Server. Pass the dialect id to `ask()` (the dialects ship in `@askdb/core`), and install the matching `@askdb/postgres`, `@askdb/mysql` (MySQL and MariaDB), `@askdb/sqlite` or `@askdb/sqlserver` package to introspect that engine. Postgres is the reference dialect. `cockroachdb` is also a built-in dialect id that reuses the Postgres spec, but it sits outside the 1.0 support claim because the consumer lab doesn't cover it ([ADR 0029](docs/adrs/0029-core-owns-built-in-dialect-specs.md)).

**Current limitations (pre-1.0 / dev):** AskDB returns SQL only (execution stays in your app); SQL guardrails are heuristic (not a full SQL parser); a first-party MCP server, richer report generation, and a hosted dashboard are roadmap work. Per-feature scope and status: [`docs/specs/`](docs/specs).

**CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs `pnpm install --frozen-lockfile`, `pnpm build`, starts the multi-engine fixture, runs `pnpm test`, runs the installable smoke test, and validates publish with a dry run.

## What it does

- **Natural language → checked SQL** grounded in your database schema, with heuristic guardrails that catch common model mistakes (non-`SELECT` statements, stacked statements, write keywords, missing tenant columns, sensitive columns).
- **Human-reviewed schema enrichment** — introspect your database, then enrich the schema artifact with descriptions, aliases, and business concepts using Studio.
- **Clear execution boundary** — AskDB returns SQL; the library, CLI, and HTTP API do not execute it against your database. Your application decides whether to show it, review it, approve it, run it, log it, or reject it.
- **Multiple surfaces** — the same schema artifact and generation pipeline across the CLI, a Node library, and an HTTP API.
- **Multi-tenancy** — define a tenant policy (roots, hierarchy, scoped/polymorphic/global tables) and pass a runtime tenant scope to `ask()`; AskDB prompts the model to filter by tenant, binds your tenant IDs into the SQL, and runs a heuristic check that each scoped table has a tenant predicate that filters (its tenant column compared with the tenant placeholder, ANDed into the filter). Enforce tenant isolation in the database as the primary boundary.

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

Phases 1–11 are implemented: core, CLI, HTTP API, installable package seams, schema artifact format, Postgres introspection, schema enrichment, RAG indexing and retrieval, Studio (React browser UI), multi-tenancy proof, and the MySQL, MariaDB, SQLite and SQL Server engines. The first 1.0 release candidate, `1.0.0-rc.1`, was published on 2026-11-09. Stable 1.0 and later phases are in [`docs/roadmap.md`](docs/roadmap.md).

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
