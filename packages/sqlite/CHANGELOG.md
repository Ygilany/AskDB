# @askdb/sqlite

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [1f46cd1]
  - @askdb/core@0.5.0-beta.10
  - @askdb/introspect@0.3.0-beta.3

## 0.1.0-beta.1

### Minor Changes

- 5ac67fc: **Ship `@askdb/mysql`, `@askdb/sqlite`, and `@askdb/sqlserver` — direct introspection connectors for the non-Postgres relational engines.** Each package pairs with its `DialectSpec` in `@askdb/core` and exposes the same shape as `@askdb/postgres`: a `Connector` for `@askdb/introspect`, a live catalog query runner backed by the engine's standard driver, and the matching dialect re-export for convenience.
  - `@askdb/mysql` — introspects via `information_schema` (tables, columns, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mysql2`. Exports `createMysqlConnector`, `createMysqlCatalogQueryRunner`, `describeMysql`, `MYSQL_DIALECT`, `MARIADB_DIALECT`.
  - `@askdb/sqlite` — introspects via `sqlite_master` and the `pragma_*` table-valued functions (SQLite ≥ 3.16). Optional peer: `better-sqlite3`. Exports `createSqliteConnector`, `createSqliteCatalogQueryRunner`, `describeSqlite`, `SQLITE_DIALECT`.
  - `@askdb/sqlserver` — introspects via `sys.*` catalog views (schemas, tables, columns with precision/scale rendering, primary keys, unique constraints, foreign keys, indexes, views). Optional peer: `mssql`. System schemas (`sys`, `INFORMATION_SCHEMA`, `db_*`, `guest`) are excluded by default. Exports `createSqlServerConnector`, `createSqlServerCatalogQueryRunner`, `describeSqlServer`, `SQLSERVER_DIALECT`.

  **CLI: `askdb introspect --engine mysql|sqlite|sqlserver`.** The CLI now wires the three new connectors behind `--engine`. Live mode only (no `--from-export` yet); `--url` carries the driver-native connection string for MySQL/SQL Server and the file path for SQLite. The shipped `provider` is persisted into `schema.json`, so `askdb ask` continues to auto-pick the matching dialect without further configuration.

  **Scope notes.** v1 surfaces tables, views, columns (with engine-correct type strings), primary keys, unique constraints, foreign keys (with referential actions), and indexes. Comments / default expressions / SQLite check constraints are not yet captured for these engines — follow-ups will close gaps as needed. From-export bundle mode and `askdb introspect templates` remain Postgres-only for now.

### Patch Changes

- 07dbc9a: **`askdb.config.ts` now configures MySQL / SQLite / SQL Server directly — no `--engine` flag required.**

  Adds three new discriminated-union branches to `AskDbIntrospectionConfig`, matching the existing postgres / prisma shape:

  ```ts
  introspection: {
    provider: "mysql",
    providerConfig: { mysql: { databaseUrl: env("DATABASE_URL") } },
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlite",
    providerConfig: { sqlite: { file: "./data/app.db" } },  // path, not URL
    outputDir: "./askdb/",
  }
  // or
  introspection: {
    provider: "sqlserver",
    providerConfig: { sqlserver: { databaseUrl: env("MSSQL_URL") } },
    outputDir: "./askdb/",
  }
  ```

  **Resolution ladder** per engine — first non-empty value wins:
  1. `introspection.providerConfig.<engine>.<field>` (structured)
  2. Provider-specific env key: `ASKDB_INTROSPECT_MYSQL_URL` / `ASKDB_INTROSPECT_SQLITE_FILE` / `ASKDB_INTROSPECT_SQLSERVER_URL`
  3. `DATABASE_URL` fallback — **for MySQL and SQL Server only**. SQLite has no `DATABASE_URL` fallback because file paths and URLs aren't interchangeable.

  **Runtime view.** `AskDbRuntimeIntrospectionConfig` gains resolved per-engine fields:

  ```ts
  introspection: {
    provider: AskDbIntrospectionProvider; // widened to all 5 ids
    prismaSchemaPath: string | undefined;
    mysqlDatabaseUrl: string | undefined;
    sqliteFile: string | undefined;
    sqlserverDatabaseUrl: string | undefined;
    outputDir: string | undefined;
  }
  ```

  **CLI.** `askdb introspect` now defaults `--engine` to `rt.introspection.provider` when the flag isn't passed, so `askdb introspect` works flag-free for every configured engine. Error messages name all three configuration paths (structured / env key / `DATABASE_URL`) so the precedence is discoverable.

  **The `database` block stays Postgres-only** — it's the RAG / pgvector home and isn't widened in this change. Non-Postgres introspection is self-contained inside its own `introspection` branch.

  **Compatibility.** Strictly additive. Existing configs continue to type-check and behave identically; the only widening user code sees is `AskDbRuntimeIntrospectionConfig.provider`, which goes from `"postgres" | "prisma"` to all five ids.

- Updated dependencies [eb325a2]
- Updated dependencies [a4f14f7]
  - @askdb/core@0.5.0-beta.4
  - @askdb/introspect@0.3.0-beta.2
