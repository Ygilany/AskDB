# `@askdb/sqlserver`

Microsoft SQL Server integration for AskDB. Bundles three pieces:

1. **Dialect** — re-exports `SQLSERVER_DIALECT` from `@askdb/core`. Pass `dialect: SQLSERVER_DIALECT` to `ask()` to target SQL Server (T-SQL).
2. **Connector** — `createSqlServerConnector()` implements the `Connector` contract from `@askdb/introspect` for live introspection mode.
3. **Catalog runner** — `createSqlServerCatalogQueryRunner(connectionString)` returns an introspection-only `CatalogQueryRunner` backed by `mssql` (peer dependency, lazy-loaded). Introspects via `sys.*` catalog views.

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/sqlserver
```

`mssql` is an **optional peer dependency** — install it only when using live introspection mode:

```bash
pnpm add mssql
```

## Usage

### NL→SQL

```ts
import { ask, loadSchema } from "@askdb/core";
import { SQLSERVER_DIALECT } from "@askdb/sqlserver";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How many paid orders were created last month?",
  schema,
  model,
  dialect: SQLSERVER_DIALECT,
});
```

### Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createSqlServerConnector, createSqlServerCatalogQueryRunner } from "@askdb/sqlserver";

const result = await introspect(
  {
    mode: "live",
    runner: createSqlServerCatalogQueryRunner(
      "Server=host,1433;Database=mydb;User Id=sa;Password=pass;",
    ),
  },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createSqlServerConnector() },
);
```

## Captured metadata

Tables, views, columns (SQL Server native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
