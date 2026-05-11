# `@askdb/core`

Dialect-agnostic NL→SQL pipeline for AskDB. Provides `ask()` orchestration, the executor seam, schema/IR types, modes, and logging. Bring your own dialect adapter (e.g. `@askdb/postgres`), your own model, and your own executor.

> **Status:** pre-1.0. `0.3.0` is a **breaking change**: the Postgres dialect, the `connectionString` shortcut, and the `@askdb/core/postgres` subpath move out to `@askdb/postgres`. See [`docs/adrs/0002-integration-package-layout.md`](../../docs/adrs/0002-integration-package-layout.md).

## Install

```bash
pnpm add @askdb/core
# Plus a dialect adapter for the engine you target:
pnpm add @askdb/postgres pg
```

`@askdb/core` itself does not depend on `pg`. The optional `pg` peer lives on `@askdb/postgres`.

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
```

## Minimal example — with the Postgres dialect adapter

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect, createPostgresExecutor } from "@askdb/postgres";
import { openai } from "@ai-sdk/openai";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");

const { sql, result } = await ask({
  question: "Top 5 customers by lifetime value?",
  schema,
  model: openai("gpt-4o"),
  dialect: postgresDialect,
  executor: createPostgresExecutor(process.env.DATABASE_URL!),
  execute: true,
});
```

## Minimal example — BYO executor (no `pg`)

```ts
import { ask, loadSchema, type AskDbExecutor } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";
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
  dialect: postgresDialect,
  executor,
  execute: true,
});
```

## What you get

- `ask({ question, schema, model, dialect, executor?, execute? })` — the pipeline.
- `AskDialect` — the dialect adapter contract. `@askdb/postgres` exports a ready-made one.
- `AskDbExecutor` / `TabularResult` — the executor seam contract.
- `loadSchema(path)` — load a Schema v2 directory, bundled JSON, or `schema.json` path.
- `loadSchemaFromJson(raw)` — parse a Schema v2 bundled JSON string (e.g. from an env var).
- `parseTableMarkdown` / `writeTableMarkdown` — round-trippable describable-layer parser/writer.
- `extractSqlFromModelText` — generic fenced-code extractor (dialect-agnostic).
- Structured logging hooks (`createAskDbLogger`, log-event contract).
- Modes (`schema_only`, etc.) per `docs/contracts/modes-v1.md`.

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
