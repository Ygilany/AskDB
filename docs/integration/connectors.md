# Authoring an AskDB connector

This page is the reference contract for adding a new connector to AskDB. AskDB currently ships two: [`@askdb/postgres`](../../packages/postgres/README.md) (live catalog SQL + air-gapped export bundles) and [`@askdb/prisma`](../../packages/prisma/README.md) (reads `schema.prisma` files offline). More are planned, and they all plug into [`@askdb/introspect`](../../packages/introspect/README.md) through the same small surface.

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
};
```

A connector must produce a fully-formed `SqlSchema`. The orchestrator hands the result to the Schema v2 renderer (`renderToSchemaV2`) without rewriting it, so every guarantee below is the connector's responsibility.

### Stable IDs

Each table and column carries an ID that survives across re-introspection runs.

- `table.id`: `"table:<schema>.<name>"` (or `"table:<name>"` in the `public` schema per Schema v2 convention).
- `column.id`: `"table:<schema>.<name>#<column>"`.

The `@askdb/postgres` connector exposes shared helpers (`makeTableId`, `makeColumnId`) and `@askdb/prisma` mirrors them. Use the same format so the enrichment layer (`tables/<name>.md` markdown) keeps matching after schema changes.

### Filters

`IntrospectionFilters` is the single shape used by every connector. Honour all three fields:

```ts
export type IntrospectionFilters = {
  schemas?: string[];           // include list; default `["public"]` for relational engines
  excludeSchemas?: string[];    // additive — always exclude system schemas as well
  tables?: string[];            // glob patterns matched against "<schema>.<name>"
};
```

System schemas (`information_schema`, `pg_catalog`, `pg_toast*`, `pg_temp_*`) must always be excluded regardless of `filters.excludeSchemas`. When a table-glob pattern matches no rows, emit an `ambiguous_filter` warning so callers can spot typos.

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

## Optional: dialect adapter

A connector covers schema introspection. SQL generation is a separate seam — the `AskDialect` adapter consumed by `ask()` in `@askdb/core`:

```ts
import type { AskDialect } from "@askdb/core";

export const myDialect: AskDialect = {
  async generate(question, schema, model, options) { /* … */ },
};
```

A connector package may export both (`@askdb/postgres` ships `postgresDialect` next to `createPostgresConnector`) or only one (`@askdb/prisma` provides introspection only; users still pair it with `postgresDialect` or another dialect for SQL generation).

Ship a dialect when the integration target has a distinct SQL surface — a new database engine, a new flavour of read-only constraints, a different prompt body. Skip it when your connector just produces Schema v2 for an existing dialect.

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
- (Optional) a dialect (`xDialect`) and any helpers it needs.
- (Optional) the template bundle constants when `templates()` is implemented.

Add the package to the workspace's `pnpm-workspace.yaml`, depend on `@askdb/introspect` (and `@askdb/core` only if exporting a dialect), and add the engine to `apps/cli/src/introspect.ts` so the `--engine` flag wires it up. Update [`docs/integration/installable-package.md`](installable-package.md) and the `Packages` section of the docs site with the new package.

---

## Testing checklist

Mirror what the Postgres and Prisma connectors do today:

1. **Unit:** a representative source → expected `SqlSchema`, including filters, ordering, and warnings.
2. **Filter:** verify schemas/exclude/tables behaviour, including the system-schema guarantee and `ambiguous_filter` emission.
3. **Determinism:** re-running the connector on unchanged input produces byte-identical `schema.json`.
4. **Re-introspection:** running through `introspect()` against an existing output directory preserves table/column IDs, emits `new_column` for additions, and `orphan_id` for references that disappear.
5. **Integration (when applicable):** for a live runner, hit a real instance (e.g. Pagila for Postgres) and snapshot the output. For file readers, commit fixture inputs alongside the snapshot.

---

## Reference connectors

- **Postgres** — [`packages/postgres`](../../packages/postgres). Live + air-gapped modes, full template bundle, `pg`-backed `CatalogQueryRunner`, and `postgresDialect`.
- **Prisma** — [`packages/prisma`](../../packages/prisma). File-only input, no `templates()`, no dialect. Pair with `postgresDialect` (or another dialect once shipped) for SQL generation.
