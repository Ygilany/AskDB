# Feature: Schema Introspection

**Status:** Complete  
**Packages:** `@askdb/introspect`, `@askdb/connectors`, `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`

## Overview

Schema introspection turns a real database into a describable schema physical artifact (`schema.json`). The `@askdb/introspect` package is engine-agnostic: it defines the `Connector<TInput>` interface and the orchestrator. Engine-specific logic — catalog SQL, row shapes, dialect rules, and optional live database driver loading — lives in the integration packages (`@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/prisma`).

Postgres has two front doors that produce identical artifacts: **live** (queries run against a real database via a catalog query runner) and **air-gapped** (queries are run offline and their output is bundled; the connector ingests the bundle). MySQL, SQLite, and SQL Server currently provide live connectors. Live connectors resolve their database drivers as optional peers from the adapter package graph or the caller project running the CLI.

Re-introspection is ID-anchored: existing stable IDs are preserved, new columns get fresh IDs, orphaned IDs (columns removed from the DB) surface as warnings. The describable layer (`tables/*.md`, `concepts.md`) is never touched by introspection.

`@askdb/connectors` provides a provider registry that mirrors the `@askdb/ai` pattern: each integration package exports a `ConnectorProviderAdapter` constant (e.g. `postgresConnectorProvider`), and `createConnectorRegistry` from `@askdb/connectors` wires them together. The CLI and apps use the registry rather than importing concrete packages directly. See [ADR 0007](../adrs/0007-connector-registry.md).

## Scope

### In scope

- `introspect()` orchestrator in `@askdb/introspect` — connector-agnostic, produces `IntrospectionResult` and writes the physical `schema.json`
- `Connector<TInput>` interface — generic over the integration's input shape; `templates()` is optional
- **`@askdb/postgres`** — catalog SQL templates (`pg_catalog` + `information_schema`), live mode via `createPostgresCatalogRunner`, air-gapped mode via bundle ingestion; deterministic `ORDER BY` on all queries; `pg_constraint.conkey` order for multi-column FKs; `pg_enum.enumsortorder` for enums; partition leaf filtering (see [ADR 0003](../adrs/0003-postgres-partition-handling.md))
- **`@askdb/mysql`** — MySQL/MariaDB connector; live mode
- **`@askdb/sqlite`** — SQLite connector; live mode
- **`@askdb/sqlserver`** — SQL Server connector; live mode
- **`@askdb/prisma`** — Prisma schema file connector; `templates()` not applicable (no catalog SQL)
- `askdb introspect` CLI subcommand — `--url` (live), `--from-export` (air-gapped), `--diff` (no writes), `--print` (stdout), `templates --engine <engine>` (print SQL)
- ID-anchored re-introspection merge — preserves existing IDs, emits `IntrospectionWarning` for orphans and new columns
- Structured logging reusing modes/observability conventions — events under `askdb.introspect.*`

### Out of scope

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
// @askdb/introspect — engine-agnostic core
introspect(options: IntrospectOptions): Promise<IntrospectionResult>

interface Connector<TInput> {
  describe(input: TInput, filters: IntrospectionFilters): Promise<SqlSchema>
  templates?(): Record<string, string>
}

interface IntrospectionResult {
  schema: SqlSchema
  warnings: IntrospectionWarning[]
}

// @askdb/connectors — registry (mirrors @askdb/ai pattern)
import { createConnectorRegistry } from '@askdb/connectors'
import type { ConnectorRegistry, ConnectorProviderAdapter } from '@askdb/connectors'

const registry: ConnectorRegistry = createConnectorRegistry({ postgres, mysql, ... })
registry.createConnector(provider, config)   // returns { mode, input, connector }
registry.getTemplates(provider)              // returns SQL template strings

// Each integration package exports its adapter constant:
// @askdb/postgres → postgresConnectorProvider: ConnectorProviderAdapter
// @askdb/mysql    → mysqlConnectorProvider
// @askdb/sqlite   → sqliteConnectorProvider
// @askdb/sqlserver → sqlserverConnectorProvider
// @askdb/prisma   → prismaConnectorProvider
```

`ConnectorConfig` (passed to `registry.createConnector()`):
```ts
interface ConnectorConfig {
  url?: string            // live mode: database connection URL
  fromExport?: string     // air-gapped mode: path to exported catalog bundle
  filters?: IntrospectionFilters
}
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
- Live integration test (CI-gated, requires Postgres): `askdb introspect --url $DATABASE_URL` produces a `schema.json` the schema loader accepts; two runs with no DB change produce no diff.
- Packaged CLI install smoke verifies that `askdb` does not install `pg` by itself and that a project-installed driver satisfies live Postgres introspection loading.
