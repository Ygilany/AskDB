# `@askdb/sqlserver`

Microsoft SQL Server introspection connector for AskDB. Introspects via `sys.*` catalog views, backed by `mssql`. Pairs with `@askdb/core`'s `SQLSERVER_DIALECT`.

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/sqlserver mssql
```

`mssql` is an **optional peer dependency**. Install it only when using live introspection mode.

## Usage

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
  { outDir: "./askdb", schemaId: "my-schema" },
  { connector: createSqlServerConnector() },
);
```

## Captured metadata

Tables, views, columns (SQL Server native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes.

## License

Apache-2.0
