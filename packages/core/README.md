# @askdb/core

NL→SQL pipeline that turns a natural-language question + a describable AskDB schema into a validated read-only PostgreSQL `SELECT` — with **BYO LanguageModel** (any AI SDK–compatible model) and **BYO database executor** (pg, postgres.js, Neon HTTP, MCP-mediated DB, or your own).

> **Status:** pre-1.0. The exports listed in `src/index.ts` and the contracts under `docs/contracts/` follow semver from `0.1.0` onward. `0.2.0` is a **breaking change**: the Schema v2 format replaces the previous format. See [Schema format](#schema-format) below.

## Install

```bash
pnpm add @askdb/core
# only if you want the built-in pg executor:
pnpm add pg
```

`pg` is an **optional peer dependency**. If you supply your own `executor`, you don't need it installed.

## Schema format

`@askdb/core` uses **Schema v2** — a split artifact designed for business-context enrichment and RAG chunking. See [`docs/contracts/schema-v2.md`](../../docs/contracts/schema-v2.md) for the full contract.

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
// schema.tables includes descriptions, aliases, and CQL sections when present
```

### Load a bundled JSON

```ts
import { loadSchema } from "@askdb/core";

const schema = loadSchema("./my-app.schema.bundle.json");
```

### Hand-author a `tables/<x>.md`

```markdown
---
id: table:orders
name: orders
schemaId: my-app
aliases: [purchases, sales]
columns:
  - id: table:orders#status
    enum: [pending, paid, shipped, cancelled]
    description: Order lifecycle state. Most reporting filters on `paid`.
---

# Table: orders

Customer purchase orders. One row per submitted order.

## Common query language

- "sales" usually means paid orders (`status = 'paid'`)
- "revenue" usually means `sum(total_amount)` where `status = 'paid'`
```

A v2 directory with only `schema.json` (no `tables/*.md`) is valid — every table falls back to physical names + types.

## Minimal example — BYO executor (no `pg`)

```ts
import { ask, loadSchema, type AskDbExecutor } from "@askdb/core";
import { openai } from "@ai-sdk/openai";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");

// Your own driver — postgres.js, Neon HTTP, Hyperdrive, MCP, etc.
const executor: AskDbExecutor = async (sql) => {
  // run sql in a read-only transaction with whatever driver you use,
  // and return { columns, rows } in the canonical TabularResult shape.
  return { columns: ["x"], rows: [[1]] };
};

const { sql, result } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: openai("gpt-4o"),
  executor,
  execute: true,
});
```

## Minimal example — built-in `pg` executor

```ts
import { ask, loadSchema } from "@askdb/core";
import { openai } from "@ai-sdk/openai";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");

const { sql, result } = await ask({
  question: "Top 5 customers by lifetime value?",
  schema,
  model: openai("gpt-4o"),
  connectionString: process.env.DATABASE_URL!,
  execute: true,
});
```

The built-in executor wraps each query in `BEGIN READ ONLY` so writes are rejected at the database layer.

## Subpath: `@askdb/core/postgres`

If you need direct access to the built-in helpers (e.g. to compose them into your own retry/caching layer):

```ts
import { createPostgresExecutor } from "@askdb/core/postgres";
```

The main `@askdb/core` barrel deliberately does **not** re-export pg-touching helpers, so consumers using only a custom executor never load `pg`.

## What you get

- `ask({ question, schema, model, executor | connectionString, execute? })` — the pipeline.
- `loadSchema(path)` — load a Schema v2 directory, bundled JSON, or `schema.json` path.
- `loadSchemaFromJson(raw)` — parse a Schema v2 bundled JSON string (e.g. from an env var).
- `parseTableMarkdown` / `writeTableMarkdown` — round-trippable describable-layer parser/writer.
- `AskDbExecutor` / `TabularResult` — the executor seam contract.
- Validated SQL only — `validatePostgresSelectSql` rejects writes, multi-statements, system schemas, etc.
- Structured logging hooks (`createAskDbLogger`, log-event contract).
- Modes (`schema_only`, etc.) per `docs/contracts/modes-v1.md`.

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
