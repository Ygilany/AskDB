# `@askdb/core`

Dialect-agnostic NL→SQL pipeline for AskDB. Provides `ask()` orchestration, schema/IR types, modes, logging, and retrieval input. Bring your own dialect adapter (e.g. `@askdb/postgres`) and your own model.

> **Status:** pre-1.0. `0.3.0` moved the Postgres dialect and `@askdb/core/postgres` to `@askdb/postgres`. Runtime AI provider construction lives in `@askdb/ai`; core remains BYO-model and does not read `process.env`. See [`docs/adrs/0002-integration-package-layout.md`](https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0002-integration-package-layout.md), [`docs/adrs/0005-askdb-config-and-env-bootstrap.md`](https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0005-askdb-config-and-env-bootstrap.md), and [`docs/adrs/0006-ai-provider-integration-strategy.md`](https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0006-ai-provider-integration-strategy.md).

> **Security model:** `ask()` returns SQL and never executes it. Its SQL checks (single `SELECT`/`WITH` statement, no comments, no write/DDL keywords, and the tenant and sensitive-column checks) are heuristic defense in depth that catch common model mistakes. They are not a SQL parser and not a security boundary. Run generated SQL under a read-only, least-privilege database role and enforce tenant isolation in the database. See [Safety boundaries](https://askdb.tools/concepts/safety-boundaries/).

## Install

```bash
# `ai` (Vercel AI SDK) is a required peer dependency — your app owns its version
pnpm add @askdb/core ai
# Plus a dialect adapter for the engine you target:
pnpm add @askdb/postgres
# Plus a model — either construct one directly with an AI SDK provider:
pnpm add @ai-sdk/openai
# …or use AskDB's config/env model factory (uses the @ai-sdk/* package above):
pnpm add @askdb/ai
```

`ai` is a **peer dependency** (`^6 || ^7`), not a bundled dependency: `ask()` receives a `LanguageModel` your app constructs, so core must use the same `ai` instance your app does. Hosts on AI SDK 6 (e.g. `@ai-sdk/openai@3`) and AI SDK 7 (`@ai-sdk/openai@4`) are both supported. The config-driven `@askdb/ai` / `@askdb/client` path currently requires AI SDK 7.

`@askdb/core` itself does not depend on `pg`. The optional `pg` peer lives on `@askdb/postgres` for live Postgres introspection.

Runtime AI configuration helpers live in `@askdb/ai`, which has built-in providers for OpenAI, Azure/Foundry, Google, Anthropic, and the Vercel AI Gateway (install the matching `@ai-sdk/*` package). If you use [`@askdb/config`](https://github.com/Ygilany/AskDB/blob/main/packages/config/README.md), call `bootstrapAskDbEnv()`, create an AI registry, then pass **`getAskDbRuntimeConfig().ai.aiEnv`** to `registry.createLanguageModelFromEnv(...)`.

## Schema format

`@askdb/core` uses **Schema v2** — a split artifact designed for business-context enrichment and RAG chunking. See [`docs/contracts/schema-v2.md`](https://github.com/Ygilany/AskDB/blob/main/docs/contracts/schema-v2.md) for the full contract.

### Directory layout

```text
my-app.schema/
  schema.json        # physical layer — tables, columns, types, FKs, sensitive flags
  tables/
    users.md         # describable layer — descriptions, aliases, common query language
    orders.md
  concepts.md        # optional — cross-table vocabulary
```

### Load a v2 directory

```ts
import { loadSchema } from "@askdb/core";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");
```

## Minimal example — with the Postgres dialect adapter

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
import { openai } from "@ai-sdk/openai";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");

const { sql } = await ask({
  question: "Top 5 customers by lifetime value?",
  schema,
  model: openai("gpt-4o"),
  dialect: postgresDialect,
});
```

## Parameterized output (default on)

By default `ask()` also asks the model for an unbound form of the same SQL plus a small JSON parameter manifest. Every call is still **exactly one model call** — `parameterize` does not add or remove one, and nothing here lets a caller skip the model. The question is sent unchanged (values included); this is not a redaction feature.

```ts
import { ask, bindPreparedQuery, loadSchema } from "@askdb/core";

const result = await ask({
  question: "How many cities does Colorado have?",
  schema,
  model: openai("gpt-4o"),
  dialect: "postgres",
  tenantScope,
});

// Execute either form.
await pool.query(result.sql);                       // ready to run
await pool.query(result.unboundSql!, result.params); // driver binding

// Render a form from result.parameters, then rebind locally — no model call.
const rebound = bindPreparedQuery(result.preparedQuery!, {
  state_name: "Utah",
  ":tenant_agency_ids": authorizedAgencyIds,
});
await pool.query(rebound.sql);
```

Key rules:

- `parameterize` defaults to **true**. Set `parameterize: false` when the extra output tokens are not worth it.
- If the model's extra blocks are missing or inconsistent, the extras are omitted and `result.sql` is unaffected. No new error reaches a caller who does not call `bindPreparedQuery()`.
- The model decides what to parameterize, so a mistake changes the *form*, not the query. Constrain form inputs using returned `type` and `description`.
- `bindPreparedQuery()` is mechanical: it checks names, types, and cardinality, and **does not authorize tenant IDs**. Authorization is the host's, exactly as when building `tenantScope`.
- Callers using the new fields must execute with `params`, not `tenantParams`.
- List parameters are arity-stable in `unboundSql` only on PostgreSQL/CockroachDB (`= ANY($n)`); elsewhere a changed list length changes the marker count — rebind through `bindPreparedQuery()` rather than swapping the array.
- Markers: `$N` (Postgres/CockroachDB), `?` (MySQL/MariaDB/SQLite), `@pN` (SQL Server, 0-based). Map values via `parameters[].markers` for SQL Server.

## What you get

- `ask({ question, schema, model, dialect })` — generate validated SQL (plus optional `unboundSql` / `params` / `parameters` / `preparedQuery`).
- `bindPreparedQuery(prepared, values)` — pure local rebind of a `PreparedQuery` (no model call).
- `AskDbLanguageModel` — AskDB's public name for the AI SDK language model contract.
- `AskDialect` — the dialect adapter contract. `@askdb/postgres` exports a ready-made one.
- `loadSchema(path)` — load a Schema v2 directory, bundled JSON, or `schema.json` path.
- `loadSchemaFromJson(raw)` — parse a Schema v2 bundled JSON string (e.g. from an env var).
- `parseTableMarkdown` / `writeTableMarkdown` — round-trippable describable-layer parser/writer.
- `extractSqlFromModelText` — generic fenced-code extractor (dialect-agnostic).
- Structured logging hooks (`createAskDbLogger`, log-event contract).
- Modes (`schema_only`, etc.) per `docs/contracts/modes-v1.md`.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
