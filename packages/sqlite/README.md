# `@askdb/sqlite`

SQLite integration for AskDB. Bundles three pieces:

1. **Dialect** — re-exports `SQLITE_DIALECT` from `@askdb/core`. Pass `dialect: SQLITE_DIALECT` to `ask()` to target SQLite.
2. **Connector** — `createSqliteConnector()` implements the `Connector` contract from `@askdb/introspect` for live introspection mode.
3. **Catalog runner** — `createSqliteCatalogQueryRunner(filePath)` returns an introspection-only `CatalogQueryRunner` backed by `better-sqlite3` (peer dependency, lazy-loaded). Introspects via `sqlite_master` and `PRAGMA` functions. Requires SQLite ≥ 3.16.

## Install

```bash
pnpm add @askdb/core @askdb/introspect @askdb/sqlite
```

`better-sqlite3` is an **optional peer dependency** — install it only when using live introspection mode:

```bash
pnpm add better-sqlite3
```

## Usage

### NL→SQL

```ts
import { ask, loadSchema } from "@askdb/core";
import { SQLITE_DIALECT } from "@askdb/sqlite";

const schema = loadSchema("./my-app.schema");

const { sql } = await ask({
  question: "How many paid orders were created last month?",
  schema,
  model,
  dialect: SQLITE_DIALECT,
});
```

### Introspection

```ts
import { introspect } from "@askdb/introspect";
import { createSqliteConnector, createSqliteCatalogQueryRunner } from "@askdb/sqlite";

const result = await introspect(
  { mode: "live", runner: createSqliteCatalogQueryRunner("/path/to/database.db") },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createSqliteConnector() },
);
```

## Captured metadata

Tables, views, columns (SQLite affinity type strings), primary keys, unique constraints, foreign keys, and indexes. Requires SQLite ≥ 3.16 for `pragma_*` table-valued functions.

## License

Apache-2.0
