# AskDB consumer lab

A black-box test bed for AskDB: the same logical schema and data in PostgreSQL, MySQL 8.4, MariaDB 11.4, SQL Server 2022 and SQLite, plus (in later phases) a consumer app that installs AskDB from packed tarballs or npm, exactly as an outside developer would.

The design, the scenario matrix and the phase plan are in [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).

This directory is **not** a member of the AskDB pnpm workspace. It has its own `pnpm-workspace.yaml` and lockfile, so it never resolves `workspace:` links.

## Databases

From the repo root:

```bash
pnpm lab:up      # start the containers, wait for health, seed (idempotent)
pnpm lab:down    # stop the containers; data volumes are kept
pnpm lab:reset   # remove containers, volumes and the SQLite file, then lab:up
```

| Engine | Host port | Owner (seeding) | Read-only | Database(s) |
|---|---|---|---|---|
| PostgreSQL 17 | 15432 | `lab_owner` / `lab_owner` | `lab_reader` / `lab_reader` | `askdb_lab` (schemas `org`, `people`, `billing`, `ref`) |
| MySQL 8.4 | 13306 | `root` / `lab_owner` | `lab_reader` / `lab_reader` | `askdb_lab` (every table) |
| MariaDB 11.4 | 13307 | `root` / `lab_owner` | `lab_reader` / `lab_reader` | `askdb_lab` (every table) |
| SQL Server 2022 | 11433 | `sa` / `Lab.Owner.2026` | `lab_reader` / `Lab.Reader.2026` | `askdb_lab` (same schemas) |
| SQLite | file | — | opened read-only | `.data/lab.sqlite` |

The ports avoid the repo's other fixtures (5432, 5433, 5434, 3306, 1433). SQL Server runs as `linux/amd64`; on Apple Silicon, Docker Desktop runs it under Rosetta.

Set `LAB_DB_HOST` to reach the databases on another host.

## Dataset

A small multi-tenant social-services agency. See [`dataset/NORMALIZATION.md`](dataset/NORMALIZATION.md) for the sources of truth and the rules used to compare values across engines.

- Three tenants (`org.agency`), with `agency_id` on every tenant-scoped table.
- A composite primary key and a unique constraint (`org.program`), and a composite foreign key (`people.enrollment` → `org.program`).
- A reserved-word table (`billing.order`) and a view (`billing.agency_revenue`).
- Sensitive columns (`people.client.email`, `people.client.ssn`), nullable columns, dates, timestamps near midnight, a leap day, decimals, booleans, and accented Latin and CJK text.

To change the data, edit `dataset/data/*.json` (and the DDL, if the shape changes). The seeder notices the new dataset hash and reseeds.

## Tests

```bash
pnpm -C examples/consumer-lab test
```

The suite needs the databases (`pnpm lab:up`) and fails when they are down.
