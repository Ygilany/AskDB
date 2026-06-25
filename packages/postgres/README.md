# `@askdb/postgres`

PostgreSQL integration for AskDB. Bundles four pieces:

1. **Dialect** — `postgresDialect` plus `validatePostgresSelectSql` and `generatePostgresSelectSql`. Pass `dialect: postgresDialect` to `@askdb/core`'s `ask()` to make the pipeline target PostgreSQL.
2. **Connector** — `createPostgresConnector()` implements the `Connector` contract from `@askdb/introspect` for both live and `from-export` (air-gapped bundle) modes.
3. **Templates** — the catalog SQL suite that drives both modes is exported as `POSTGRES_TEMPLATE_BUNDLE`.
4. **Catalog runner** — `createPostgresCatalogQueryRunner(connectionString)` returns an introspection-only `CatalogQueryRunner` backed by `pg` (peer dependency, lazy-loaded).

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/postgres pg
```

`pg` is an **optional peer dependency**. Install it only if you plan to use live introspection mode. The CLI does not bundle `pg`; install it in your project or include it in the same one-off command:

```sh
pnpm dlx -p askdb -p pg askdb introspect --engine postgres --url "$DATABASE_URL"
npx -p askdb -p pg askdb introspect --engine postgres --url "$DATABASE_URL"
```

## Usage

```ts
import { ask, loadSchema } from "@askdb/core";
import { postgresDialect } from "@askdb/postgres";

const schema = loadSchema("./fixtures/schemas/orders-users.schema");

const out = await ask({
  question: "How many orders did each user place last month?",
  schema,
  model: /* a LanguageModel */,
  dialect: postgresDialect,
});
```

## Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createPostgresCatalogQueryRunner, createPostgresConnector } from "@askdb/postgres";

const result = await introspect(
  { mode: "live", runner: createPostgresCatalogQueryRunner(process.env.DATABASE_URL!) },
  { outDir: "./schemas/orders-users.schema", schemaId: "orders-users" },
  { connector: createPostgresConnector() },
);
```

The connector input shape (`PostgresIntrospectionInput`) lives in this package — `@askdb/introspect` is engine-agnostic and does not know about live vs. from-export modes.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
