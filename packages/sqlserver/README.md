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

For one-off CLI introspection, include the driver in the same ephemeral command:

```bash
pnpm dlx -p askdb -p mssql askdb introspect --engine sqlserver --url "$SQLSERVER_URL"
npx -p askdb -p mssql askdb introspect --engine sqlserver --url "$SQLSERVER_URL"
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
      "Server=host,1433;Database=mydb;User Id=sa;Password=pass;TrustServerCertificate=True;",
    ),
  },
  { outDir: "./my-app.schema", schemaId: "my-app" },
  { connector: createSqlServerConnector() },
);
```

### Connection string formats

`createSqlServerCatalogQueryRunner` and `databaseUrl` in `askdb.config.ts` accept three formats:

| Format | Example |
|--------|---------|
| `mssql://` URL | `mssql://sa:pass@localhost:1433/MyDb` |
| Prisma `sqlserver://` | `sqlserver://localhost:1433;database=MyDb;user=sa;password=pass;encrypt=true` |
| ADO.NET (`Key=Value;`) | `Server=localhost,1433;Database=MyDb;User Id=sa;Password=pass;` |

**TLS / self-signed certificates**

SQL Server uses TLS by default. If you connect to a local or dev instance with a self-signed certificate you will see a `self-signed certificate` error unless you tell the driver to trust it:

- **`mssql://` URL** — append `?trustServerCertificate=true`:
  ```
  mssql://sa:pass@localhost:1433/MyDb?trustServerCertificate=true
  ```
- **Prisma URL** — append `;trustServerCertificate=true`:
  ```
  sqlserver://localhost:1433;database=MyDb;user=sa;password=pass;trustServerCertificate=true
  ```
- **ADO.NET string** — add `TrustServerCertificate=True;` (note: use the camelCase form without spaces — `Trust Server Certificate` with spaces is a known parsing gap in mssql v12):
  ```
  Server=localhost,1433;Database=MyDb;User Id=sa;Password=pass;Encrypt=True;TrustServerCertificate=True;
  ```

> **Never set `TrustServerCertificate=True` in production** unless you have verified the server's certificate through another means. Use a properly signed certificate, or install the CA cert in the system trust store (`NODE_EXTRA_CA_CERTS` / `--use-system-ca`).

## Captured metadata

Tables, views, columns (SQL Server native type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes.

## License

Apache-2.0 © [Yahya Gilany](https://yahyagilany.io). See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
