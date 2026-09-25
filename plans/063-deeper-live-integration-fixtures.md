# Plan 063: Give the MySQL, MariaDB, SQL Server and SQLite connectors real live-database coverage — composite FKs, views, unique constraints, multiple schemas, one shared golden

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
> 1. `for n in 180 191 189; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done` → `MERGED` three times.
> 2. `git grep -n "export function integrationSuite" scripts/test-utils/integration.mjs` → one match; `git grep -n "ASKDB_REQUIRE_INTEGRATION" .github/workflows/ci.yml turbo.json` → matches in both; `git grep -n "unit-node-matrix" .github/workflows/ci.yml` → one match (#191).
> 3. The gap still exists: `git grep -c "^  it(" packages/mysql/src/exec/mysql.integration.test.ts packages/sqlserver/src/exec/sqlserver.integration.test.ts` → `2` each; `git grep -n -i "mariadb" .github/workflows/ci.yml turbo.json` → no matches.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW for product code (tests, fixtures, CI only). MED for CI time and flakiness (one more service container).
- **Depends on**: PRs #180, #191, #189 (merged). Recommended **before** plan 061 (it is 061's safety net). Independent of 062/064: the golden checks connector output (`SqlSchema`), not rendered `schema.json`.
- **Category**: tests
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No.

## Why this matters

The MySQL, SQL Server and SQLite connectors each fold 5–7 catalog queries into a schema, and their live suites only check that a two-table schema has one PK and one FK. The folds that break in practice go untested against a real server: composite FK column order, composite PKs, unique-constraint vs. index classification, views, multiple schemas, and cross-database references. `@askdb/mysql` claims MariaDB support (`packages/mysql/README.md`: "MySQL / MariaDB integration") and CI never runs MariaDB. #189 fixed several bugs that exactly this kind of fixture would have caught (SQLite implicit FK targets, MySQL cross-database FKs, SQL Server `is_ms_shipped`). This plan seeds one logical schema into every engine and compares each connector's output with one hand-written expected structure, so a regression in any engine's fold fails CI.

## Current state (verified on c7404d4)

- `packages/mysql/src/exec/mysql.integration.test.ts` — `integrationSuite({ env: ["MYSQL_DATABASE_URL"] })`, `CREATE TABLE IF NOT EXISTS integration_users/integration_posts` in the shared `askdb_test` database, two `it`s (runner `SELECT 1`; `posts.foreignKeys` has length 1).
- `packages/sqlserver/src/exec/sqlserver.integration.test.ts` — same shape in `dbo`.
- `packages/sqlite/src/exec/sqlite.integration.test.ts` — users/posts/index/view in a temp file; `packages/sqlite/src/connector/describe.live.test.ts` (from #189) — in-memory PRAGMA cases (implicit FK targets, composite implicit targets, `sqlite_` prefix, unique vs. index).
- Postgres already has deep live coverage (`pagila.integration.test.ts`, `partition-fk.integration.test.ts`) — out of scope here.
- `scripts/test-utils/integration.mjs` — `integrationSuite({ env, unavailable })` returns `describe` / `describe.skip` / a failing suite under `ASKDB_REQUIRE_INTEGRATION=1`. It is plain ESM plus a sibling `integration.d.mts` so packages import it by relative path without widening their TS `rootDir` — copy that pattern for any shared helper.
- `.github/workflows/ci.yml` `test` job: services `postgres` (pgvector/pgvector:pg16), `mysql` (mysql:8.0, 3306), `sqlserver` (mssql 2022, 1433); env `MYSQL_DATABASE_URL: mysql://root:mysql@127.0.0.1:3306/askdb_test`, `MSSQL_DATABASE_URL: "Server=127.0.0.1,1433;Database=askdb_test;User Id=sa;Password=AskDB.123;Encrypt=false"`; a step creates `askdb_test` on SQL Server.
- `turbo.json` `test.env` lists the integration variables. Turbo runs in strict env mode, so a variable missing there never reaches vitest (CONTRIBUTING.md "Integration Tests" says so explicitly). `test.inputs` already includes `$TURBO_ROOT$/fixtures/**` and `$TURBO_ROOT$/scripts/test-utils/**`.
- Engine behaviors the golden must accommodate (from each `describe.ts`):
  - MySQL and SQLite emit everything under namespace `"public"`. MySQL introspects only `DATABASE()` and turns FKs into another database into a `cross_database_fk` warning (FK omitted).
  - SQL Server honours `filters.schemas` / `excludeSchemas` and emits real schema names.
  - MySQL `SQL_INDEXES` lists every non-PRIMARY index, including ones backing UNIQUE constraints; SQL Server's excludes unique-constraint indexes; SQLite lists auto-indexes (`sqlite_autoindex_*`) for UNIQUE constraints. **Compare only non-unique, explicitly created indexes.**
  - SQLite synthesizes FK names (`<table>_<cols>_fkey`) and auto-index names. **Compare FK/unique structure, not names.**
  - InnoDB auto-creates an index named after an FK when no usable index exists. **Declare explicit indexes for every FK's leading columns** so all engines end up with the same explicit index set.
  - SQLite reports `id INTEGER PRIMARY KEY` as nullable unless `NOT NULL` is written. **Declare `NOT NULL` explicitly everywhere.**

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Start fixtures | `docker compose -f fixtures/mysql/docker-compose.yml up -d --wait`; `docker compose -f fixtures/sqlserver/docker-compose.yml up -d --wait` (then create `askdb_test`, see that file); `docker compose -f fixtures/mariadb/docker-compose.yml up -d --wait` (created in Step 1) | healthy |
| Env | `export MYSQL_DATABASE_URL=mysql://root:mysql@127.0.0.1:3306/askdb_test MARIADB_DATABASE_URL=mysql://root:mariadb@127.0.0.1:3307/askdb_test MSSQL_DATABASE_URL='Server=127.0.0.1,1433;Database=askdb_test;User Id=sa;Password=AskDB.123;Encrypt=false'` | — |
| One engine | `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/mysql test` (likewise `@askdb/sqlserver`, `@askdb/sqlite`) | all pass, 0 skipped |
| All | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

If Docker is not available locally, push the branch and use the PR's CI `test` job as the verification. Say so in the PR.

## Suggested executor toolkit

- Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`) to every new test. The golden **must be written by hand from the DDL below**, never pasted from connector output ("expected values produced by the helper … under test" is a junk pattern).

## Scope

**In scope** (create unless noted):
- `fixtures/introspect/engine-parity/expected.json` and `fixtures/introspect/engine-parity/README.md`
- `scripts/test-utils/introspection-parity.mjs` + `scripts/test-utils/introspection-parity.d.mts`
- `packages/mysql/src/connector/parity.integration.test.ts` (runs for MySQL and MariaDB)
- `packages/sqlserver/src/connector/parity.integration.test.ts`
- `packages/sqlite/src/connector/parity.integration.test.ts`
- `fixtures/mariadb/docker-compose.yml`
- Edit: `.github/workflows/ci.yml` (MariaDB service + env), `turbo.json` (`MARIADB_DATABASE_URL`), `CONTRIBUTING.md` (Integration Tests table), `fixtures/introspect/README.md` (index row)
- An empty changeset only if the Changesets `status` check demands one (#180 needed one for test-only package changes)

**Out of scope**:
- Any change to connector source (`packages/*/src/connector/describe.ts`, `exec/*.ts`). A failing parity test is a finding; see STOP conditions.
- Postgres parity (already covered by Pagila and partition suites; adding it is a follow-up).
- Deleting the existing two-table suites. Leave them; plan 061 may reuse them as runner smoke tests.
- Rendered `schema.json` goldens per engine (types differ per engine and plan 062 changes the render).

## Git workflow

- Branch `plan/063-deeper-live-integration-fixtures`; one PR; do not merge. Commit style e.g. `test(mysql): live parity fixture with composite FKs, views, uniques`, `ci: add MariaDB service`.

## Steps

### Step 1: MariaDB fixture, CI service, env passthrough

- `fixtures/mariadb/docker-compose.yml`, modelled on `fixtures/mysql/docker-compose.yml`: image `mariadb:11.4`, env `MARIADB_ROOT_PASSWORD: mariadb`, `MARIADB_DATABASE: askdb_test`, port `3307:3306`, healthcheck `["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]`, and a header comment with the URL `mysql://root:mariadb@127.0.0.1:3307/askdb_test`.
- `ci.yml` `test` job: add a `mariadb` service with the same image, env, port and `--health-cmd "healthcheck.sh --connect --innodb_initialized"` options in the style of the `mysql` service; add `MARIADB_DATABASE_URL: mysql://root:mariadb@127.0.0.1:3307/askdb_test` to the job env.
- `turbo.json`: add `"MARIADB_DATABASE_URL"` to `tasks.test.env`.
- `CONTRIBUTING.md` Integration Tests table: add a `MARIADB_DATABASE_URL` row naming the new suite and the compose command.

**Verify**: `docker compose -f fixtures/mariadb/docker-compose.yml up -d --wait` → healthy (or defer to CI); `node -e "const t=require('./turbo.json');process.exit(t.tasks.test.env.includes('MARIADB_DATABASE_URL')?0:1)"` → exit 0; `actionlint .github/workflows/ci.yml` if installed → clean.

### Step 2: The shared golden and projection helper

The logical schema (write this exact shape per engine, adjusting only type spellings and quoting):

```sql
customers   (id INT NOT NULL PRIMARY KEY, email VARCHAR(255) NOT NULL, region VARCHAR(8) NOT NULL,
             CONSTRAINT uq_customers_email UNIQUE (email))
orders      (id INT NOT NULL, region VARCHAR(8) NOT NULL, customer_id INT NOT NULL,
             PRIMARY KEY (id, region),
             CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id))
            + index ix_orders_customer (customer_id)
order_lines (id INT NOT NULL PRIMARY KEY, order_region VARCHAR(8) NOT NULL, order_id INT NOT NULL,
             sku VARCHAR(32) NOT NULL, qty INT NOT NULL,
             CONSTRAINT fk_lines_order FOREIGN KEY (order_id, order_region) REFERENCES orders (id, region),
             CONSTRAINT uq_lines_order_sku UNIQUE (order_id, order_region, sku))
            + index ix_lines_sku (sku)
VIEW customer_order_counts AS
  SELECT c.id AS customer_id, COUNT(o.id) AS order_count
  FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id
```

`order_lines` declares `order_region` **before** `order_id`, but the FK lists `(order_id, order_region)`. That tests that FK column order follows the constraint, not the table.

`scripts/test-utils/introspection-parity.mjs` exports `projectNamespace(ns)`, returning:

```jsonc
{ "tables": { "<name>": {
    "columns": [{ "name": "…", "nullable": false, "primaryKey": true }],   // ordinal order
    "primaryKey": ["…"],
    "foreignKeys": [{ "columns": ["…"], "references": { "table": "…", "columns": ["…"] } }], // sorted by columns.join(",")
    "uniques": [["…"]],                                                    // sorted by join(",")
    "indexes": [{ "name": "…", "columns": ["…"] }]                         // unique === false only, sorted by name
  } },
  "views": { "<name>": { "columns": ["…"] } } }
```

It drops constraint names, `references.schema`, types, defaults and comments. Give the `.d.mts` its own minimal structural input type (do not import `@askdb/introspect`; that package does not resolve from `scripts/`). Write `fixtures/introspect/engine-parity/expected.json` **by hand** from the DDL above, plus a README explaining the rules (what is compared and what is not, and why).

**Verify**: `node -e "import('./scripts/test-utils/introspection-parity.mjs').then(m=>console.log(typeof m.projectNamespace))"` → `function`; `node -e "JSON.parse(require('fs').readFileSync('fixtures/introspect/engine-parity/expected.json','utf8'))"` → exit 0.

### Step 3: SQLite parity suite (no server — do this first to shake out the helper)

`packages/sqlite/src/connector/parity.integration.test.ts`: gate with `integrationSuite({ unavailable })` exactly like `describe.live.test.ts`; seed a temp file with the DDL (`INTEGER`/`TEXT` types, `NOT NULL` everywhere, `CREATE INDEX` for the two indexes); describe it with the **real** runner `createSqliteCatalogQueryRunner(path)` through `createSqliteConnector().describe({ mode: "live", runner })`. Cases:
1. `projectNamespace(result.schema.schemas[0])` deep-equals `expected.json`; `result.warnings` is `[]`.
2. Determinism: a second `describe` gives a deep-equal `SqlSchema`.
3. Types for two representative columns (`order_lines.sku`, `orders.id`) as SQLite reports them — inline, engine-specific.

**Verify**: `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/sqlite test` → passes, 0 skipped.

### Step 4: MySQL + MariaDB parity suite

`packages/mysql/src/connector/parity.integration.test.ts`: loop over `[{ label: "MySQL", env: "MYSQL_DATABASE_URL" }, { label: "MariaDB", env: "MARIADB_DATABASE_URL" }]`, and gate each iteration with its own `integrationSuite({ env: [target.env] })(…)`. Per target:
- **Isolation**: create a fresh database `askdb_it_<8 random hex>` from an admin connection on the base URL, and build the connector URL by replacing the URL path (`new URL(base)`, `url.pathname = "/" + db`). `DROP DATABASE IF EXISTS` in `afterAll`. Never touch `askdb_test` tables (the existing suite uses them concurrently).
- Declare `INDEX ix_orders_customer (customer_id)` inside `CREATE TABLE orders` so InnoDB does not auto-create an FK-named index.
- Cases: (1) projection equals `expected.json`, warnings `[]`; (2) determinism; (3) multi-database: in a second pair of fresh databases `<x>` and `<y>`, create `y.vendors(id PK)` and `x.supply(id PK, vendor_id NOT NULL, FOREIGN KEY (vendor_id) REFERENCES y.vendors(id))` (plus `INDEX (vendor_id)`); describe `<x>` → `supply.foreignKeys` is `[]` and `warnings` contains exactly one `{ code: "cross_database_fk", table: "table:public.supply", referencedDatabase: "<y>", referencedTable: "vendors" }` (plus its `constraint` name); (4) types for `order_lines.sku` / `orders.id` inline.

**Verify**: with both URLs set, `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/mysql test` → passes for both labels, 0 skipped.

### Step 5: SQL Server parity + multi-schema suite

`packages/sqlserver/src/connector/parity.integration.test.ts` (`integrationSuite({ env: ["MSSQL_DATABASE_URL"] })`):
- **Isolation**: random prefix `p = "askdb_it_<8 hex>"`; `CREATE SCHEMA [${p}_a]` and `[${p}_b]` (one statement per request — `CREATE SCHEMA` must be alone in its batch); seed the parity DDL into `${p}_a`; in `afterAll` drop the view, then the tables in FK order, then both schemas.
- Cases: (1) `describe({ mode: "live", runner, filters: { schemas: [`${p}_a`] } })` → exactly one namespace, and its projection equals `expected.json`; (2) determinism; (3) multi-schema: create `${p}_b.notes(id PK)` and `${p}_a.notes(id PK)` (same name), plus `${p}_b.audit(id PK, customer_id NOT NULL FK → ${p}_a.customers(id))` with an index on `customer_id`; describe with `schemas: [a, b]` → the two `notes` tables have ids `table:${p}_a.notes` and `table:${p}_b.notes`, and `audit.foreignKeys[0].references` is `{ schema: `${p}_a`, table: "customers", columns: ["id"] }`; describe with `excludeSchemas: [`${p}_b`]` plus the include list → no `${p}_b` namespace; (4) types inline (`varchar(32)` for `sku`, per `renderType`).

**Verify**: `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/sqlserver test` → passes, 0 skipped.

### Step 6: Full gate and CI

`pnpm build && pnpm lint && pnpm test` → exit 0. Push; in the PR's CI `test` job log, confirm the three new files ran with 0 skipped (`✓ src/connector/parity.integration.test.ts`) for mysql, sqlserver and sqlite, and that the MariaDB iteration ran. Update `fixtures/introspect/README.md` with an `engine-parity/` row. Run `pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

- Owner boundary for every new case: the engine's **connector plus the real catalog runner against a real engine** — the only layer where catalog SQL semantics and the fold meet. Unit tests over hand-written rows (`describe.test.ts`) cannot catch catalog-semantics regressions, so these tests do not duplicate them.
- Regressions each case catches: composite FK order following table order instead of constraint order; composite PK order; unique constraints misclassified as indexes (or lost); views dropped or missing columns; SQL Server schema filters leaking or the same table name colliding across schemas; MySQL cross-database FKs rendered as local (the #189 bug); MariaDB-specific `information_schema` differences; nondeterministic ordering.
- The golden is hand-written and shared, so one file states the cross-engine contract; per-engine type checks stay inline and small.

## Done criteria

- [ ] Readiness check passed and quoted in the PR description.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm smoke:install`, `pnpm preflight` exit 0.
- [ ] CI `test` job: the three `parity.integration.test.ts` files pass with 0 skipped; the MariaDB service is healthy and its iteration ran.
- [ ] `git grep -n "MARIADB_DATABASE_URL" turbo.json .github/workflows/ci.yml CONTRIBUTING.md` → a match in each.
- [ ] `git diff --name-only | grep -E "packages/[^/]+/src/(connector/describe|exec/[^/]+)\.ts$"` → empty (no connector source changed).
- [ ] No test leaves databases, schemas or tables behind: re-running the suites twice in a row passes.

## STOP conditions

- Readiness check fails.
- Any engine's projection differs from `expected.json` for a reason that is a **connector bug** (for example, MariaDB returns a different FK column order). Do not weaken the golden and do not fix the connector in this PR. Report the engine, the diff and the catalog query involved; the maintainer will open a fix plan. If the difference is a legitimate engine semantic this plan did not anticipate, report it with a proposed projection rule.
- The CI runner cannot start the MariaDB service within the health budget twice in a row — report timings.
- A test needs `DROP`/`CREATE` rights the CI `sa`/`root` users lack.

## Maintenance notes

- When a connector gains a feature (for example, plan 062's `enumValues` or SQL Server comments), extend the projection and `expected.json` together. Keep the rule that the golden is written by hand.
- Plan 061 (session-scoped runner) should re-run these suites; they are its regression net for the sequential-query rewrite.
- Deferred: Postgres in the same parity harness; SQLite `ATTACH`ed databases (the connector does not support them); a MySQL 5.7 matrix entry.
