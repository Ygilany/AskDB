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
import { ask, loadSchema } from "@askdb/core";

// Load a Schema v2 directory (physical + describable layers)
const schema = loadSchema("./my-app.schema");

const { sql, result } = await ask({
  question: "How many users signed up last week?",
  schema,
  model: /* your LanguageModel */,
  executor: /* your AskDbExecutor */,
  execute: true,
});
```

`loadSchema` autodetects between a v2 directory, a bundled JSON file, and a direct `schema.json` path. For inline JSON (e.g. from an env var), use `loadSchemaFromJson(raw)` instead.

### Schema v2 directory layout

```text
my-app.schema/
  schema.json        # physical layer — tables, columns, types, FKs, sensitive flags
  tables/
    users.md         # describable layer — descriptions, aliases, common query language
    orders.md
  concepts.md        # optional — cross-table domain vocabulary
```

A directory with only `schema.json` (no `tables/*.md`) is valid — tables fall back to bare names + types. See [`docs/contracts/schema-v2.md`](../contracts/schema-v2.md) for the full format contract.

Pass either `executor` (BYO) or `connectionString` (built-in `pg`). If both are passed, `executor` wins and the pipeline emits a `askdb.config.executor_overrides_connection_string` log event.

---

## Produce a Schema v2 Artifact with `@askdb/introspect`

`@askdb/introspect` is the canonical first-run path before enrichment. It writes the physical layer (`schema.json`) from database catalog metadata; the describable layer (`tables/*.md`, `concepts.md`) can then be added by Phase 7 tooling or by hand.

### Live Postgres

```bash
pnpm add @askdb/introspect @askdb/core pg

export DATABASE_URL=postgres://user:pass@host:5432/db

askdb-introspect \
  --url "$DATABASE_URL" \
  --out my-app.schema \
  --schema-id my-app
```

The same runner is available through `@askdb/cli`:

```bash
askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
```

### Air-Gapped Postgres

Use this path when AskDB cannot connect to the database.

```bash
askdb-introspect templates --engine postgres > pg-introspection.sql
```

Run the template queries in `psql`, an IDE, or CI, and save one CSV or JSON file per template plus a manifest:

```text
pg-export/
  manifest.json
  schemas.csv
  tables.csv
  columns.csv
  primary_keys.csv
  foreign_keys.csv
  unique_constraints.csv
  check_constraints.csv
  indexes.csv
  enums.csv
  sequences.csv
  views.csv
  comments.csv
```

```json
{
  "engine": "postgres",
  "version": 1
}
```

Then render the same Schema v2 artifact without opening a database connection:

```bash
askdb-introspect \
  --from-export ./pg-export \
  --out my-app.schema \
  --schema-id my-app
```

### Re-Introspection and Enrichment

Re-running introspection against an existing output directory performs an ID-anchored merge:

- `schema.json` is updated for physical changes.
- Existing IDs and physical `sensitive` flags are preserved.
- New columns emit `new_column` warnings.
- Removed IDs referenced from `tables/*.md` emit `orphan_id` warnings.
- The describable layer is never written by introspection.

This supports the intended flow:

```text
askdb-introspect -> my-app.schema/schema.json
enrich descriptions/aliases/concepts in my-app.schema/
re-run askdb-introspect as the database changes
loadSchema("./my-app.schema") for NL-to-SQL or RAG
```

### Enrich with `@askdb/tui`

Install the TUI alongside the CLI when you want guided authoring:

```bash
pnpm add @askdb/cli @askdb/introspect @askdb/tui pg

askdb introspect --url "$DATABASE_URL" --out my-app.schema --schema-id my-app
askdb enrich --schema my-app.schema
```

Inside the TUI, walk tables and columns to add descriptions, aliases, `Common query language`, example questions, and concepts. Press `g` on supported fields to request an AI suggestion when `OPENAI_API_KEY` is set; suggestions are queued for accept/edit/reject and are never saved until you press `s`.

To ship a single read-only artifact to another service:

```bash
askdb bundle my-app.schema --out my-app.schema.bundle.json
```

`loadSchema("./my-app.schema.bundle.json")` and `loadSchema("./my-app.schema")` produce the same normalized representation.

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
- [`packages/introspect/README.md`](../../packages/introspect/README.md) — live and air-gapped schema introspection
- [`docs/specs/phase-4-publish-npm/requirements.md`](../specs/phase-4-publish-npm/requirements.md) — Phase 4 contract decisions, including executor-seam invariants
- [`docs/contracts/modes-v1.md`](../contracts/modes-v1.md) — operating modes around execution (`schema_only`, `bounded_results`)
- [`docs/integration/reuse-core-phase-3.md`](./reuse-core-phase-3.md) — stable surfaces for thin wrappers (CLI/HTTP/MCP)
