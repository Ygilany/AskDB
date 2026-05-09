# `@askdb/core` as an installable package — BYO model + BYO executor

Phase 4 ships `@askdb/core` to npm with two pluggable seams:

1. **BYO `LanguageModel`** — any model that satisfies the AI SDK's [`LanguageModel`](https://sdk.vercel.ai/docs) interface. The pipeline calls `generateText` against whatever you pass.
2. **BYO `AskDbExecutor`** — a function that runs a validated read-only `SELECT` against your own driver and returns rows in the canonical [`TabularResult`](../../packages/core/src/exec/types.ts) shape.

The built-in `pg` executor stays the reference implementation; consumers who only use a custom executor never need `pg` installed.

> See the contract definitions in [`packages/core/src/exec/executor.ts`](../../packages/core/src/exec/executor.ts) and the spec in [`docs/specs/phase-4-publish-npm/requirements.md`](../specs/phase-4-publish-npm/requirements.md).

---

## Install

```bash
pnpm add @askdb/core
# only if you want the built-in pg executor:
pnpm add pg
```

`pg` is an **optional peer dependency**. Skip it if you supply your own executor.

---

## Minimal pipeline

```ts
import { ask, loadNormalizedSchemaFromJson } from "@askdb/core";
import { readFile } from "node:fs/promises";

const schema = loadNormalizedSchemaFromJson(
  await readFile("./schema.json", "utf8"),
);

const { sql, result } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: /* your LanguageModel */,
  executor: /* your AskDbExecutor */,
  execute: true,
});
```

Pass either `executor` (BYO) or `connectionString` (built-in `pg`). If both are passed, `executor` wins and the pipeline emits a `askdb.config.executor_overrides_connection_string` log event.

---

## BYO `LanguageModel` recipes

### OpenAI (direct)

```ts
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { sql } = await ask({
  question, schema,
  model: openai("gpt-4o-mini"),
});
```

### Anthropic

```ts
import { anthropic } from "@ai-sdk/anthropic";

const { sql } = await ask({
  question, schema,
  model: anthropic("claude-3-5-sonnet-latest"),
});
```

### AWS Bedrock

```ts
import { bedrock } from "@ai-sdk/amazon-bedrock";

const { sql } = await ask({
  question, schema,
  model: bedrock("anthropic.claude-3-5-sonnet-20241022-v2:0"),
});
```

### Ollama (local models)

Use any AI SDK community provider that exposes a `LanguageModel`. Example:

```ts
import { createOllama } from "ollama-ai-provider";
const ollama = createOllama({ baseURL: "http://localhost:11434/api" });

const { sql } = await ask({
  question, schema,
  model: ollama("llama3.1"),
});
```

### Vercel AI Gateway

If you're routing through the AI Gateway for failover, cost tracking, or OIDC-based auth, use the `gateway` provider from the AI SDK:

```ts
import { gateway } from "ai";

const { sql } = await ask({
  question, schema,
  model: gateway("openai/gpt-4o-mini"),
});
```

---

## BYO `AskDbExecutor` recipes

The `AskDbExecutor` contract — see [`exec/executor.ts`](../../packages/core/src/exec/executor.ts):

```ts
type AskDbExecutor = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<TabularResult>;

type TabularResult = {
  columns: string[];
  rows: unknown[][];
};
```

**Invariants the executor must uphold:**

1. **Read-only execution.** The consumer is responsible for ensuring writes can't happen — at the driver, transaction, or database role layer. The built-in executor uses `BEGIN READ ONLY`.
2. **Stable shape.** Return rows as `unknown[][]` aligned with `columns` (string[]). Don't return rows as objects keyed by column name.
3. **Errors propagate.** Throw or reject; the pipeline logs `askdb.pipeline.failed` with `phase: "execute"` and rethrows.

### Built-in `pg` (the default)

```ts
import { ask } from "@askdb/core";

const { sql, result } = await ask({
  question, schema,
  model,
  connectionString: process.env.DATABASE_URL,
  execute: true,
});
```

Or construct the executor yourself for composition (caching, retries, custom logging):

```ts
import { createPostgresExecutor } from "@askdb/core/postgres";

const executor = createPostgresExecutor(process.env.DATABASE_URL!);
```

### `postgres.js`

```ts
import postgres from "postgres";
import type { AskDbExecutor } from "@askdb/core";

const sql = postgres(process.env.DATABASE_URL!, { max: 5 });

const executor: AskDbExecutor = async (queryText) => {
  // postgres.js doesn't expose a per-call read-only flag — set it on the
  // role/connection or wrap in a transaction with SET TRANSACTION READ ONLY.
  const rows = await sql.unsafe(queryText);
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((row: Record<string, unknown>) => columns.map((c) => row[c])),
  };
};
```

### Neon HTTP (serverless)

```ts
import { neon } from "@neondatabase/serverless";
import type { AskDbExecutor } from "@askdb/core";

const sqlClient = neon(process.env.DATABASE_URL!);

const executor: AskDbExecutor = async (queryText) => {
  const result = await sqlClient(queryText, [], { fullResults: true });
  return {
    columns: result.fields.map((f) => f.name),
    rows: result.rows.map((row: Record<string, unknown>) =>
      result.fields.map((f) => row[f.name]),
    ),
  };
};
```

### MCP-mediated database

If your database access flows through an MCP server (e.g. for audit, RBAC, or per-tenant routing), the executor becomes a thin MCP `tools/call`:

```ts
import type { AskDbExecutor } from "@askdb/core";

const executor: AskDbExecutor = async (sql) => {
  const response = await mcpClient.callTool("db.query.read_only", { sql });
  // Adapt your MCP server's response to the AskDB contract:
  return {
    columns: response.columns,
    rows: response.rows,
  };
};
```

The MCP server is responsible for the read-only guarantee — typically by enforcing it on the database role or via `BEGIN READ ONLY` inside the tool implementation.

---

## When to pick which seam

| Want… | Pass… |
|---|---|
| Simplest path; you already use Postgres + `pg` | `connectionString` (built-in) |
| Different driver (`postgres.js`, Neon, Hyperdrive) | `executor` |
| Per-tenant routing, audit, or MCP-mediated DB | `executor` |
| Existing connection pool you want to reuse | `executor` (wrap your pool) |
| Mocked DB in tests / no DB at all | `executor` (return canned `TabularResult`) |

If both are passed, `executor` wins. The pipeline emits a structured warning event so misconfigurations surface in logs.

---

## See also

- [`packages/core/README.md`](../../packages/core/README.md) — quick install + minimal examples
- [`docs/specs/phase-4-publish-npm/requirements.md`](../specs/phase-4-publish-npm/requirements.md) — Phase 4 contract decisions, including executor-seam invariants
- [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md) — operating modes around execution (`schema_only`, `bounded_results`)
- [`docs/integration/reuse-core-phase-3.md`](./reuse-core-phase-3.md) — stable surfaces for thin wrappers (CLI/HTTP/MCP)
