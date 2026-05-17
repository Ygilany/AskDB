# `@askdb/mysql`

MySQL / MariaDB integration for AskDB. Bundles three pieces:

1. **Dialect** — re-exports `MYSQL_DIALECT` and `MARIADB_DIALECT` from `@askdb/core`. Pass `dialect: MYSQL_DIALECT` (or `MARIADB_DIALECT`) to `ask()` to target MySQL or MariaDB.
2. **Connector** — `createMysqlConnector()` implements the `Connector` contract from `@askdb/introspect` for live introspection mode.
3. **Catalog runner** — `createMysqlCatalogQueryRunner(connectionString)` returns an introspection-only `CatalogQueryRunner` backed by `mysql2` (peer dependency, lazy-loaded).

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/mysql
```

`mysql2` is an **optional peer dependency** — install it only when using live introspection mode:

```bash
pnpm add mysql2
```

## Usage

### NL→SQL

```ts
import { ask, loadSchema } from "@askdb/core";
import { MYSQL_DIALECT } from "@askdb/mysql";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How many paid orders were created last month?",
  schema,
  model,
  dialect: MYSQL_DIALECT,
});
```

Use `MARIADB_DIALECT` instead when your runtime engine is MariaDB.

### Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createMysqlConnector, createMysqlCatalogQueryRunner } from "@askdb/mysql";

const result = await introspect(
  { mode: "live", runner: createMysqlCatalogQueryRunner(process.env.DATABASE_URL!) },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createMysqlConnector() },
);
```

## Captured metadata

Tables, views, columns (MySQL-native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes.

## License

Apache-2.0
