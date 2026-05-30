# Feature: Schema Introspection

**Status:** Complete  
**Packages:** `@askdb/introspect`, `@askdb/postgres`

## Overview

Schema introspection turns a real database into a Schema v2 physical artifact (`schema.json`). The `@askdb/introspect` package is engine-agnostic: it defines the `Connector<TInput>` interface and the orchestrator. Engine-specific logic — catalog SQL, row shapes, and dialect rules — lives in the integration package (`@askdb/postgres` for Postgres).

Two equally-supported front doors produce identical artifacts: **live** (queries run against a real database via a catalog query runner) and **air-gapped** (queries are run offline and their output is bundled; the connector ingests the bundle). This separation lets teams introspect air-gapped or locked-down databases by exporting the catalog queries separately.

Re-introspection is ID-anchored: existing stable IDs are preserved, new columns get fresh IDs, orphaned IDs (columns removed from the DB) surface as warnings. The describable layer (`tables/*.md`, `concepts.md`) is never touched by introspection.

## Scope

### In scope

- `introspect()` orchestrator in `@askdb/introspect` — connector-agnostic, produces `IntrospectionResult` and writes Schema v2 `schema.json`
- `Connector<TInput>` interface — generic over the integration's input shape; `templates()` is optional
- Postgres connector in `@askdb/postgres` — catalog SQL templates (`pg_catalog` + `information_schema`), live mode via `createPostgresCatalogRunner`, air-gapped mode via bundle ingestion
- Deterministic catalog SQL — all queries include explicit `ORDER BY`; `pg_constraint.conkey` order preserved for multi-column FKs; `pg_enum.enumsortorder` preserved for enums
- Partition leaf filtering — declarative partition leaves are excluded at the SQL boundary; partitioned parents (`relkind = 'p'`) are kept. See [ADR 0003](../adrs/0003-postgres-partition-handling.md)
- `askdb introspect` CLI subcommand — `--url` (live), `--from-export` (air-gapped), `--diff` (no writes), `--print` (stdout), `templates --engine postgres` (print SQL)
- ID-anchored re-introspection merge — preserves existing IDs, emits `IntrospectionWarning` for orphans and new columns
- Structured logging reusing Phase 2 conventions — events under `askdb.introspect.*`

### Out of scope

- MySQL, SQLite, Prisma connectors — tracked in Phase 11; the `Connector` interface is the seam
- Schema enrichment (writing `tables/*.md`) — see [`schema-authoring-and-enrichment.md`](./schema-authoring-and-enrichment.md)
- Plain table inheritance (`CREATE TABLE x INHERITS (y)`) — kept; these are semantically distinct from partitions
- Foreign tables (`relkind = 'f'`) — not included

## Design decisions

- **One package per integration surface** — `@askdb/introspect` is engine-agnostic; `@askdb/postgres` owns everything Postgres-specific. Adding MySQL is a new package, not a change to introspect or core. See [ADR 0002](../adrs/0002-integration-package-layout.md).
- **Two front doors, identical output** — live and air-gapped modes call the same connector `describe()` and produce byte-identical `schema.json`. The air-gapped path ingests CSV/JSON bundles exported from the same SQL templates.
- **Partition leaves filtered at SQL boundary** — a partitioned `events` table with 64 monthly partitions should appear once, not 65 times. Filtering at the catalog SQL layer (not the chunker or renderer) means all downstream consumers benefit automatically. See [ADR 0003](../adrs/0003-postgres-partition-handling.md).
- **Describing layer never modified** — re-introspection only rewrites `schema.json`. `tables/*.md` and `concepts.md` are owned by human authors; introspection respects that boundary.
- **`Connector.templates()` is optional** — Prisma has no catalog SQL; the `templates()` method is optional to allow non-SQL connectors to implement the interface cleanly.

## Contracts and API surface

```ts
// @askdb/introspect
introspect(options: IntrospectOptions): Promise<IntrospectionResult>

interface Connector<TInput> {
  describe(input: TInput, filters: IntrospectionFilters): Promise<SqlSchema>
  templates?(): Record<string, string>
}

interface IntrospectionResult {
  schema: SqlSchema
  warnings: IntrospectionWarning[]
}

// @askdb/postgres
import { postgresConnector, createPostgresCatalogRunner } from '@askdb/postgres'
import type { PostgresIntrospectionInput } from '@askdb/postgres'
```

`PostgresIntrospectionInput`:
```ts
type PostgresIntrospectionInput =
  | { mode: 'live'; runner: CatalogQueryRunner; filters?: IntrospectionFilters }
  | { mode: 'from-export'; bundlePath: string; filters?: IntrospectionFilters }
```

`IntrospectionWarning` codes: `orphan_id`, `new_column`, `bundle_missing_file`, `bundle_unknown_engine`

## Test bar

- `pnpm build` and `pnpm test` pass from repo root.
- Postgres connector produces a stable `SqlSchema` from a pinned catalog snapshot — golden file test, no live DB required.
- Multi-column FK column order matches `pg_constraint.conkey` order (regression guard for the documented Drizzle bug).
- Enum values preserve `pg_enum.enumsortorder`.
- Two runs on the same catalog snapshot produce byte-identical `SqlSchema` JSON.
- Partition fixture: declarative partition leaves absent from output; parent retained.
- Air-gapped round-trip: export catalog snapshot as CSV bundle; ingest via `--from-export`; result byte-identical to live-mode output from the same data.
- ID-anchored re-introspection: adding a column preserves existing IDs, adds a fresh ID for the new column, emits one `new_column` warning; `tables/*.md` untouched.
- Live integration test (CI-gated, requires Postgres): `askdb introspect --url $DATABASE_URL` produces a `schema.json` the Schema v2 loader accepts; two runs with no DB change produce no diff.
