# Multi-engine fixture

One logical schema and one dataset, held identically in PostgreSQL 17, MySQL 8.4, MariaDB 11.4, SQL Server 2022 and SQLite. Package integration tests introspect each engine and compare the result with one golden logical schema. The [consumer lab](../../docs/specs/consumer-lab.md) uses the same databases to test AskDB as a black box. This fixture replaces Pagila.

This is a private workspace package (`@askdb/fixture-multi-engine`). It never imports AskDB, so it can judge any AskDB version.

## Running it

From the repo root:

```bash
pnpm fixture:up      # start the containers, wait for health, seed (idempotent)
pnpm fixture:down    # stop the containers; data volumes are kept
pnpm fixture:reset   # remove containers, volumes and the SQLite file, then fixture:up
```

Suites that use the fixture run when `ASKDB_FIXTURE_HOST` is set (to `127.0.0.1` locally). With `ASKDB_REQUIRE_INTEGRATION=1`, as in CI, they fail instead of skipping when it isn't.

| Engine | Host port | Owner (seeding) | Read-only | Database(s) |
|---|---|---|---|---|
| PostgreSQL 17 | 15432 | `fixture_owner` / `fixture_owner` | `fixture_reader` / `fixture_reader` | `askdb_fixture` (schemas `org`, `people`, `billing`, `ref`) |
| MySQL 8.4 | 13306 | `root` / `fixture_owner` | `fixture_reader` / `fixture_reader` | `org`, `people`, `billing`, `ref` (one database per logical schema) |
| MariaDB 11.4 | 13307 | `root` / `fixture_owner` | `fixture_reader` / `fixture_reader` | `org`, `people`, `billing`, `ref` |
| SQL Server 2022 | 11433 | `sa` / `Fixture.Owner.2026` | `fixture_reader` / `Fixture.Reader.2026` | `askdb_fixture` (same schemas) |
| SQLite | file | — | opened read-only | `fixtures/multi-engine/.data/multi-engine.sqlite` |

The ports avoid the repo's other fixtures and CI services (5432, 5434, 3306, 1433). SQL Server runs as `linux/amd64`; on Apple Silicon, Docker Desktop runs it under Rosetta.

## Using it from a test

Import the helpers by relative path (the same way suites import `scripts/test-utils/integration.mjs`):

```ts
import { integrationSuite } from "../../../../scripts/test-utils/integration.mjs";
import {
  FIXTURE_HOST_ENV,
  LOGICAL_SCHEMAS,
  compareToLogicalSchema,
  connectionUrl,
} from "../../../../fixtures/multi-engine/src/index.js";

const fixtureSuite = integrationSuite({ env: [FIXTURE_HOST_ENV] });
// connectionUrl("postgres", "reader") → postgres://fixture_reader:…@127.0.0.1:15432/askdb_fixture
// compareToLogicalSchema(schemaJson, { expectNamespaces: true }) → [] when the artifact matches
```

## Dataset

A small multi-tenant social-services domain. [`dataset/NORMALIZATION.md`](dataset/NORMALIZATION.md) describes the sources of truth and the rules used to compare values and schemas across engines.

- **Tenant hierarchy.** `org.agency` is a self-referencing tree (`parent_agency_id`): three roots (São Paulo, Zürich, Tokyo). São Paulo has children Campinas and Santos, and Santos has a child, Santos Norte; Zürich has one child, Winterthur. The intended visibility: an agency sees its own rows and every descendant's, never an ancestor's, and never anything outside its tree. Every tenant-scoped table carries `agency_id`.
- **Keys.** A composite primary key and a unique constraint (`org.program`), and a composite foreign key (`people.enrollment` → `org.program`).
- **Postgres partitioning.** `billing.payment` is declaratively partitioned on Postgres only; introspection must render the parent, not the leaves (ADR 0003).
- **Other shapes.** A reserved-word table (`billing.order`), a view (`billing.agency_revenue`), and a global table (`ref.status`).
- **Sensitive data.** Sensitive columns (`people.client.email`, `people.client.ssn`).
- **Values.** NULLs, dates, timestamps near midnight, leap days, decimals, booleans, and accented Latin and CJK text.

To change the data, edit `dataset/data/*.json`, and the DDL and `schema.logical.json` as well if the shape changes. The seeder notices the new dataset hash and reseeds.

## Self-check

`test/dataset.integration.test.ts` reads every table back as `fixture_reader` and checks, on every engine, that:

- the rows equal the JSON;
- the view matches an oracle;
- the reader cannot write.

```bash
ASKDB_FIXTURE_HOST=127.0.0.1 pnpm --filter @askdb/fixture-multi-engine test
```
