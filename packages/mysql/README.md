# `@askdb/mysql`

MySQL / MariaDB introspection connector for AskDB. Introspects via `information_schema` and pairs with `@askdb/core`'s `MYSQL_DIALECT`.

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/mysql mysql2
```

`mysql2` is an **optional peer dependency**. Install it only when using live introspection mode.

## Usage

```ts
import { introspect } from "@askdb/introspect";
import { createMysqlConnector, createMysqlCatalogQueryRunner } from "@askdb/mysql";

const result = await introspect(
  { mode: "live", runner: createMysqlCatalogQueryRunner("mysql://user:pass@host/db") },
  { outDir: "./askdb", schemaId: "my-schema" },
  { connector: createMysqlConnector() },
);
```

## Captured metadata

Tables, views, columns (MySQL-native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes.

## License

Apache-2.0
