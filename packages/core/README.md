# @askdb/core

NL→SQL pipeline that turns a natural-language question + a normalized AskDB schema into a validated read-only PostgreSQL `SELECT` — with **BYO LanguageModel** (any AI SDK–compatible model) and **BYO database executor** (pg, postgres.js, Neon HTTP, MCP-mediated DB, or your own).

> **Status:** pre-1.0. The exports listed in `src/index.ts` and the contracts under `docs/contracts/` follow semver from `0.1.0` onward.

## Install

```bash
pnpm add @askdb/core
# only if you want the built-in pg executor:
pnpm add pg
```

`pg` is an **optional peer dependency**. If you supply your own `executor`, you don't need it installed.

## Minimal example — BYO executor (no `pg`)

```ts
import { ask, type AskDbExecutor } from "@askdb/core";
import { loadNormalizedSchemaFromJson } from "@askdb/core";
import { openai } from "@ai-sdk/openai";
import { readFile } from "node:fs/promises";

const schema = loadNormalizedSchemaFromJson(
  JSON.parse(await readFile("./schema.json", "utf8")),
);

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
import { ask, loadNormalizedSchemaFromJson } from "@askdb/core";
import { openai } from "@ai-sdk/openai";

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
- `AskDbExecutor` / `TabularResult` — the executor seam contract.
- `loadNormalizedSchemaFromJson` — parse + normalize an AskDB schema JSON v1 file.
- Validated SQL only — `validatePostgresSelectSql` rejects writes, multi-statements, system schemas, etc.
- Structured logging hooks (`createAskDbLogger`, log-event contract).
- Modes (`schema_only`, etc.) per `docs/contracts/modes-v1.md`.

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
