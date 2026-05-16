# `@askdb/sqlite`

SQLite introspection connector for AskDB. Introspects via `sqlite_master` and `PRAGMA` functions, backed by `better-sqlite3`. Pairs with `@askdb/core`'s `SQLITE_DIALECT`.

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/sqlite better-sqlite3
```

`better-sqlite3` is an **optional peer dependency**. Install it only when using live introspection mode.

## Usage

```ts
import { introspect } from "@askdb/introspect";
import { createSqliteConnector, createSqliteCatalogQueryRunner } from "@askdb/sqlite";

const result = await introspect(
  { mode: "live", runner: createSqliteCatalogQueryRunner("/path/to/database.db") },
  { outDir: "./askdb", schemaId: "my-schema" },
  { connector: createSqliteConnector() },
);
```

## Captured metadata

Tables, views, columns (SQLite affinity type strings), primary keys, unique constraints, foreign keys, and indexes. Requires SQLite ≥ 3.16 for `pragma_*` table-valued functions.

## License

Apache-2.0
