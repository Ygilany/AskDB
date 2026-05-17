---
"@askdb/config": minor
"@askdb/sqlite": patch
"askdb": minor
---

**`askdb.config.ts` now configures MySQL / SQLite / SQL Server directly — no `--engine` flag required.**

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
  provider: AskDbIntrospectionProvider;  // widened to all 5 ids
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
