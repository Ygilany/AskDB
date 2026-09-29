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

For one-off CLI introspection, include the driver in the same ephemeral command:

```bash
pnpm dlx -p askdb -p mysql2 askdb introspect --engine mysql --url "$MYSQL_URL"
npx -p askdb -p mysql2 askdb introspect --engine mysql --url "$MYSQL_URL"
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

By default the connector reads the connection URL's database and renders it under the `public` namespace. In that mode the connection string must name a database (`mysql://user:pass@host:3306/<database>`); introspection throws a clear error when the connection has no default database instead of returning an empty schema. To introspect several databases, list them in `filters.schemas`. Each database then becomes its own namespace, and foreign keys into another listed database keep the referenced database:

```ts
await introspect(
  {
    mode: "live",
    runner: createMysqlCatalogQueryRunner(process.env.DATABASE_URL!),
    filters: { schemas: ["app", "sales", "analytics"] },
  },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createMysqlConnector() },
);
```

With the `askdb` CLI, set `introspection.schemas` in `askdb.config.ts`, or pass `--schemas app,sales`.

`mysqlConnectorProvider` parses a connection into display-safe parts, so a connector registry's `connectionLabel()` shows only the host, port and database of a `mysql://` URL, read the way `mysql2` reads it (WHATWG `URL`; `mysql://root:S3cret@db:3306/shop` → `mysql://db:3306/shop`). Anything else becomes `configured mysql connection`.

## Captured metadata

Tables, views, columns (MySQL-native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes. Only the connection's database, or the databases listed in `filters.schemas`, is introspected: foreign keys that reference a table in any other database are omitted and reported as a `cross_database_fk` warning.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
