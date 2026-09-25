# Authoring an AskDB connector

This page is the reference contract for adding a new connector to AskDB. AskDB currently ships five first-party connectors, all plugging into [`@askdb/introspect`](../../packages/introspect/README.md) through the same small surface and registered with the CLI/Studio through [`@askdb/connectors`](../../packages/connectors/README.md):

- [`@askdb/postgres`](../../packages/postgres/README.md) — live catalog SQL + air-gapped export bundles.
- [`@askdb/mysql`](../../packages/mysql/README.md) — live `information_schema` queries against the connection's database.
- [`@askdb/sqlite`](../../packages/sqlite/README.md) — live `sqlite_master` + `pragma_*` queries against a database file.
- [`@askdb/sqlserver`](../../packages/sqlserver/README.md) — live `sys.*` catalog queries.
- [`@askdb/prisma`](../../packages/prisma/README.md) — reads `schema.prisma` files offline.

Architecture context lives in [ADR 0002 — Integration-package layout](../adrs/0002-integration-package-layout.md): connectors are engine-specific, `@askdb/introspect` is engine-agnostic, and each integration owns its own input shape.

---

## What a connector is

A connector is the adapter that lets `@askdb/introspect` turn a source of schema metadata (a database catalog, a Prisma schema file, a future MySQL `information_schema`, …) into a Schema v2 `SqlSchema`. It is one TypeScript object satisfying the `Connector<TInput>` interface defined in `@askdb/introspect`:

```ts
export interface Connector<TInput = unknown> {
  describe(input: TInput): Promise<IntrospectionResult>;
  templates?(): SqlTemplateBundle;
}
```

The two methods are the entire required surface. Everything else — what `TInput` looks like, how `describe` produces tables and columns, whether `templates()` exists — is owned by the integration package.

---

## Required: `describe(input)`

`describe` takes the integration's input shape and returns an `IntrospectionResult`:

```ts
export type IntrospectionResult = {
  schema: SqlSchema;
  warnings: IntrospectionWarning[];
  isEmpty: boolean;
  /** Keyed by `"table:<schema>.<view>"`. */
  viewDefinitions: Record<string, string>;
  /** Optional dialect id (`"postgres"`, `"mysql"`, …) persisted into `schema.json`. */
  provider?: string;
};
```

A connector must produce a fully-formed `SqlSchema`. The orchestrator hands the result to the Schema v2 renderer (`renderToSchemaV2`) without rewriting it, so every guarantee below is the connector's responsibility.

### Stable IDs

Each table and column carries an ID that survives across re-introspection runs.

- `table.id`: `"table:<schema>.<name>"` — always schema-qualified, including `public`.
- `column.id`: `"table:<schema>.<name>#<column>"`.

Engines without Postgres-style schemas (MySQL, SQLite) emit everything under a single `public` namespace so ids stay stable across engines. Each first-party connector keeps a small private `ids.ts` (`makeTableId`, `makeColumnId`); use the same format so the enrichment layer (`tables/<name>.md` markdown) keeps matching after schema changes.

### Filters

`IntrospectionFilters` is the single shape used by every connector. Honour all three fields:

```ts
export type IntrospectionFilters = {
  schemas?: string[];           // include list; omitted/empty → every non-system schema
  excludeSchemas?: string[];    // additive — always exclude system schemas as well
  tables?: string[];            // glob patterns matched against "<schema>.<name>"
};
```

There is no default include list: with `schemas` unset, `@askdb/postgres` and `@askdb/sqlserver` introspect every non-system schema (pass `schemas: ["public"]` to narrow it). System schemas (Postgres: `information_schema`, `pg_catalog`, `pg_toast*`, `pg_temp_*`; SQL Server: `sys`, `INFORMATION_SCHEMA`, the `db_*` role schemas, `guest`) and engine-internal objects (SQLite `sqlite_*` tables, SQL Server `is_ms_shipped` objects) must always be excluded regardless of `filters.excludeSchemas`. When a table-glob pattern matches no rows, emit an `ambiguous_filter` warning so callers can spot typos.

### Determinism

Re-introspecting an unchanged source must produce a byte-identical `schema.json`. That requires:

- A stable iteration order — sort tables, columns, foreign keys, unique constraints, indexes, and enums by their name.
- Preserved multi-column constraint order — foreign-key `columns` and `references.columns` arrays follow the source's declared order (in Postgres, `pg_constraint.conkey` / `confkey`). Sorting these alphabetically is a bug.
- Preserved enum value order — Postgres uses `pg_enum.enumsortorder`; Prisma uses declaration order.
- A populated `ordinalPosition` on every column starting at `1`.

### Warnings, not exceptions

Use `IntrospectionWarning` for everything the user should see but that isn't a hard failure:

| Code | When |
| --- | --- |
| `unsupported_type` | A column whose type the connector cannot represent (e.g. Prisma `Unsupported("…")`). |
| `view_with_array_columns` | A view exposes array columns the renderer cannot fully describe. |
| `ambiguous_filter` | A `tables` glob pattern matched nothing. |
| `cross_database_fk` | A foreign key targets a table in another database (e.g. MySQL `REFERENCES otherdb.t`); the relationship is omitted because its target is not in the artifact. |
| `new_column` | (Render-time) A new column id appeared since the previous run. |
| `orphan_id` | (Render-time) An id referenced by markdown is gone from the source. |

Hard failures (missing input file, unsupported provider, runner error) should `throw` so the CLI surfaces them and exits non-zero.

### `isEmpty` and `viewDefinitions`

- `isEmpty` is `true` when no namespace contains any table. The CLI prints a clearer message when set.
- `viewDefinitions` maps `"table:<schema>.<view>"` to the view's SQL text when available. Connectors with no view support return `{}`.

---

## Optional: `templates()`

Implement `templates()` only for engines that introspect by running catalog SQL. The bundle is what `askdb introspect templates --engine <id>` prints, and what the air-gapped `--from-export` path reads back.

```ts
export type SqlTemplateBundle = {
  engine: string;          // e.g. "postgres"
  version: number;         // bump when any template's shape changes
  templates: readonly SqlTemplate[];
};

export type SqlTemplate = {
  name: string;            // stable; maps to a CSV/JSON file in an export bundle
  sql: string;             // parameterized; bound by the connector at run time
  columns: readonly string[]; // declared column list — used to validate CSV headers
};
```

Connectors that read schema files (Prisma) or call a non-SQL API legitimately omit `templates()`. `@askdb/introspect` checks for its presence before calling.

---

## Input shape

Each integration owns its own `TInput`. There is no shared discriminated union — every connector exports whatever the engine actually needs.

`@askdb/postgres` ships a two-mode union for live catalogs and exported bundles:

```ts
export type PostgresIntrospectionInput =
  | { mode: "live"; runner: CatalogQueryRunner; filters?: IntrospectionFilters }
  | { mode: "from-export"; bundlePath: string; filters?: IntrospectionFilters };
```

`@askdb/prisma` ships a file-path shape:

```ts
export type PrismaIntrospectionInput = {
  schemaPath: string;                // .prisma file or directory of .prisma files
  schemaId?: string;
  filters?: IntrospectionFilters;
};
```

Choose the shape that's honest for the source. A connector that reads files should not pretend it has a `live` mode; a connector that needs network credentials should not pretend it can run from a path alone.

---

## Live execution: `CatalogQueryRunner`

If the connector reads from a database, expose a query-runner factory rather than baking in a driver:

```ts
export type CatalogQueryResult = {
  columns: string[];
  rows: unknown[][];
};

export type CatalogQueryRunner = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<CatalogQueryResult>;
```

Rules:

- The runner is **introspection-only**. It is never used to execute generated user SQL — that boundary is enforced in `@askdb/core`.
- Drivers are optional peer dependencies. `@askdb/postgres` lazy-loads `pg` from inside `createPostgresCatalogQueryRunner` so consumers that only generate SQL never pull a driver into their dependency graph.
- Callers can BYO runners. Expose the type so tests and alternative drivers (e.g. `postgres.js`, Neon HTTP) can plug in without modifying the connector.

---

## SQL dialects live in `@askdb/core`

A connector covers schema introspection only. SQL generation is driven by a `DialectSpec` — a small descriptor (prompt brief, identifier quoting, extra forbidden keywords, optional post-validator) — and the built-in specs all live in `@askdb/core` ([`packages/core/src/sql/dialect-spec.ts`](../../packages/core/src/sql/dialect-spec.ts)): `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `MYSQL_DIALECT`, `MARIADB_DIALECT`, `SQLITE_DIALECT`, `SQLSERVER_DIALECT`. The centralized pipeline in `@askdb/core` owns prompt assembly and validation for all of them.

```ts
import { ask } from "@askdb/core";

await ask({ question, schema, model, dialect: "mysql" }); // BuiltInDialectId, DialectSpec, or AskDialect
```

Engine packages only re-export their spec for convenience (`@askdb/mysql` re-exports `MYSQL_DIALECT`, `@askdb/postgres` keeps `postgresDialect` as a compatibility alias of `POSTGRES_DIALECT`). A connector should surface the matching dialect id through `IntrospectionResult.provider` so hosts can auto-select it from `schema.json`.

A genuinely new SQL surface means adding a `DialectSpec` to `@askdb/core`, not to the connector package. For a one-off, `ask()` also accepts a custom `AskDialect` (`{ generate(question, schema, model, options) }`) as a full escape hatch.

---

## Package layout

A first-party integration follows the same skeleton:

```
packages/<name>/
  package.json            # name "@askdb/<name>", "type": "module"
  README.md
  LICENSE
  NOTICE
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts              # public exports
    <connector>.ts        # createXConnector(), describeX()
    …
```

Required published exports:

- `createXConnector(): Connector<XInput>` — the factory the CLI and library callers wire up.
- `describeX(input: XInput): Promise<IntrospectionResult>` — the bare function, useful for tests and bespoke pipelines that bypass the orchestrator.
- The input type (`XIntrospectionInput`).
- `xConnectorProvider: ConnectorProviderAdapter` — the `@askdb/connectors` adapter that turns a `ConnectorConfig` into the connector + input pair.
- `redactConnectionString(input: string): string` — masks credentials in every connection-string format the engine accepts, for display and logs (build it on the helpers in `@askdb/connectors`).
- (Optional) a re-export of the engine's `DialectSpec` from `@askdb/core`.
- (Optional) the template bundle constants when `templates()` is implemented.

Add the package to the workspace's `pnpm-workspace.yaml`, depend on `@askdb/introspect` and `@askdb/connectors`, add the provider id to `CONNECTOR_PROVIDERS` in `@askdb/connectors`, and register the adapter in the `createConnectorRegistry([...])` calls in `apps/cli/src/introspect.ts` and `apps/studio/src/introspection.ts` so `--engine` / Studio wire it up. Update [`docs/integration/installable-package.md`](installable-package.md) and the `Packages` section of the docs site with the new package.

---

## Testing checklist

Mirror what the first-party connectors do today:

1. **Unit:** a representative source → expected `SqlSchema`, including filters, ordering, and warnings.
2. **Filter:** verify schemas/exclude/tables behaviour, including the system-schema guarantee and `ambiguous_filter` emission.
3. **Determinism:** re-running the connector on unchanged input produces byte-identical `schema.json`.
4. **Re-introspection:** running through `introspect()` against an existing output directory preserves table/column IDs, emits `new_column` for additions, and `orphan_id` for references that disappear.
5. **Integration (when applicable):** for a live runner, hit a real instance (e.g. Pagila for Postgres) and snapshot the output. For file readers, commit fixture inputs alongside the snapshot.

---

## Reference connectors

- **Postgres** — [`packages/postgres`](../../packages/postgres). Live + air-gapped modes, full template bundle, `pg`-backed `CatalogQueryRunner`.
- **MySQL** — [`packages/mysql`](../../packages/mysql). Live only, `mysql2`-backed runner; introspects the connection's database as a single `public` namespace.
- **SQLite** — [`packages/sqlite`](../../packages/sqlite). Live only, `better-sqlite3`-backed runner over a database file.
- **SQL Server** — [`packages/sqlserver`](../../packages/sqlserver). Live only, `mssql`-backed runner; URL, Prisma/JDBC-style and ADO.NET connection strings.
- **Prisma** — [`packages/prisma`](../../packages/prisma). File-only input, no `templates()`; sets `provider` from the declared `datasource.provider` so the matching `@askdb/core` dialect is auto-selected.
