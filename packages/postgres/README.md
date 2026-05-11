# `@askdb/postgres`

PostgreSQL integration for AskDB. Bundles four pieces:

1. **Dialect** — `postgresDialect` plus `validatePostgresSelectSql` and `generatePostgresSelectSql`. Pass `dialect: postgresDialect` to `@askdb/core`'s `ask()` to make the pipeline target PostgreSQL.
2. **Connector** — `createPostgresConnector()` implements the `Connector` contract from `@askdb/introspect` for both live and `from-export` (air-gapped bundle) modes.
3. **Templates** — the catalog SQL suite that drives both modes is exported as `POSTGRES_TEMPLATE_BUNDLE`.
4. **Executor** — `createPostgresExecutor(connectionString)` returns a read-only `AskDbExecutor` backed by `pg` (peer dependency, lazy-loaded).

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/postgres pg
```

`pg` is an **optional peer dependency**. Install it only if you plan to run the built-in executor or the live introspection mode.

## Usage

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect, createPostgresExecutor } from "@askdb/postgres";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");
const executor = createPostgresExecutor(process.env.DATABASE_URL!);

const out = await ask({
  question: "How many orders did each user place last month?",
  schema,
  model: /* a LanguageModel */,
  dialect: postgresDialect,
  execute: true,
  executor,
});
```

## Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresConnector, createPostgresExecutor } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", executor: createPostgresExecutor(process.env.DATABASE_URL!) },
  { outDir: "./schemas/orders-users.schema", schemaId: "orders-users" },
  { connector: createPostgresConnector() },
);
```

The connector input shape (`PostgresIntrospectionInput`) lives in this package — `@askdb/introspect` is engine-agnostic and does not know about live vs. from-export modes.
