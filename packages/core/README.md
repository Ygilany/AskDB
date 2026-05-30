# `@askdb/core`

Dialect-agnostic NL→SQL pipeline for AskDB. Provides `ask()` orchestration, schema/IR types, modes, logging, and retrieval input. Bring your own dialect adapter (e.g. `@askdb/postgres`) and your own model.

> **Status:** pre-1.0. `0.3.0` moved the Postgres dialect and `@askdb/core/postgres` to `@askdb/postgres`. Runtime AI provider construction lives in `@askdb/ai`; core remains BYO-model and does not read `process.env`. See [`docs/adrs/0002-integration-package-layout.md`](../../docs/adrs/0002-integration-package-layout.md), [`docs/adrs/0005-askdb-config-and-env-bootstrap.md`](../../docs/adrs/0005-askdb-config-and-env-bootstrap.md), and [`docs/adrs/0006-ai-provider-integration-strategy.md`](../../docs/adrs/0006-ai-provider-integration-strategy.md).

## Install

```bash
pnpm add @askdb/core
# Plus a dialect adapter for the engine you target:
pnpm add @askdb/postgres
# Plus a model provider, for example:
pnpm add @ai-sdk/openai
# Optional AskDB config/env model factory:
pnpm add @askdb/ai
```

`@askdb/core` itself does not depend on `pg`. The optional `pg` peer lives on `@askdb/postgres` for live Postgres introspection.

Runtime AI configuration helpers live in `@askdb/ai`. If you use [`@askdb/config`](../../packages/config/README.md), call `bootstrapAskDbEnv()` then pass **`getAskDbRuntimeConfig().ai.aiEnv`** to `createAskDbLanguageModelFromEnv` from `@askdb/ai`.

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

## What you get

- `ask({ question, schema, model, dialect })` — generate validated SQL.
- `AskDbLanguageModel` — AskDB's public name for the AI SDK language model contract.
- `AskDialect` — the dialect adapter contract. `@askdb/postgres` exports a ready-made one.
- `loadSchema(path)` — load a Schema v2 directory, bundled JSON, or `schema.json` path.
- `loadSchemaFromJson(raw)` — parse a Schema v2 bundled JSON string (e.g. from an env var).
- `parseTableMarkdown` / `writeTableMarkdown` — round-trippable describable-layer parser/writer.
- `extractSqlFromModelText` — generic fenced-code extractor (dialect-agnostic).
- Structured logging hooks (`createAskDbLogger`, log-event contract).
- Modes (`schema_only`, etc.) per `docs/contracts/modes-v1.md`.

## License

Apache-2.0 © Yahya Gilany. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
