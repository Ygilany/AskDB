# Feature: Consumer lab

**Status:** Approved 2026-09-26. Being built in phases (see [Phased PR breakdown](#phased-pr-breakdown)).
**Location:** `examples/consumer-lab/` (excluded from the pnpm workspace)
**Packages under test:** every publishable package, installed from tarballs or npm. No workspace linking.

## Overview

The consumer lab tests AskDB as a black box, the way its users run it. It has three parts:

1. **Docker databases.** One database per supported engine: PostgreSQL, MySQL 8, MariaDB, SQL Server 2022, and SQLite (a file). All five hold the same logical schema and the same rows, and differ only by dialect.
2. **A consumer app.** It is written the way an outside developer would write it from the docs site at askdb.tools. It installs AskDB from packed tarballs, a published version, or a local registry. It imports only documented public exports. Because it is the host app, it executes the generated SQL under a read-only role.
3. **A vitest suite inside that app.** The suite runs the same scenarios against every dialect and compares the results with each other and with an independent oracle computed from the seed data.

Existing tests can't catch the failures the lab targets. Unit tests import workspace source through `dist`. The `*.integration.test.ts` suites exercise one engine package against one database. `pnpm smoke:install` checks that the tarballs install and import, but runs nothing against a database. None of them catch:

- a tarball that installs but behaves differently from the workspace build;
- generated SQL that passes validation but doesn't run on a real engine;
- parameter or tenant-placeholder markers that the real driver can't bind;
- dialects that disagree on the answer to the same question;
- a documented surface (CLI, HTTP API, Studio) that has drifted from its docs.

## Design principles

- **Docs are the spec.** Every import, CLI flag, config key and HTTP route the lab uses must appear in `apps/docs-site/src/content/docs/` or `docs/` (contracts, specs, ADRs). Where docs and behavior disagree, the lab records a discrepancy. It never bends the test to match the code.
- **No product changes to make tests pass.** When the lab finds a bug, the failing lab test lands first. The fix follows in a separate, focused PR with a changeset.
- **The lab is independent of the version under test.** The dataset, the seeder, the oracle, normalization and the replay model server never import AskDB. They use database drivers and Node built-ins only. This lets the same lab judge any branch or published version.
- **CI never needs an API key.** The CI model is a deterministic replay. A live model is for exploration only.
- **Every test passes the test-audit authoring gate.** See [Test-audit compliance](#test-audit-compliance).

## Dataset

### Logical schema

The domain is a small multi-tenant social-services agency. It is small enough to read in one sitting, and it covers every requested feature.

| Logical schema | Table / view | Key points |
|---|---|---|
| `org` | `agency` | **Tenant root.** `agency_id` PK, `name` (unicode), `founded_on` date, `created_at` timestamp. Three tenants: "Agência São Paulo", "Zürich Dienste", "東京オフィス". |
| `org` | `program` | **Composite PK** `(agency_id, program_code)`, `name`, `budget` decimal(12,2), `is_active` boolean, `starts_on` date, `ends_on` date **nullable**. **Unique** `(agency_id, name)`. |
| `people` | `client` | `client_id` PK, `agency_id` FK, `full_name` (unicode), `email` **unique, sensitive**, `ssn` **sensitive, nullable**, `birth_date` date, `created_at` timestamp. |
| `people` | `enrollment` | PK `(client_id, program_code)`, `agency_id`, **composite FK** `(agency_id, program_code) → org.program`, `enrolled_on` date, `exited_on` nullable date, `status_code` FK to `ref.status`. |
| `billing` | `order` | **Reserved-word table name.** `order_id` PK, `agency_id`, `client_id` FK, `placed_at` timestamp, `total` decimal(10,2), `is_paid` boolean, `note` nullable unicode. |
| `billing` | `order_line` | Composite PK `(order_id, line_no)`, `sku`, `quantity` int, `unit_price` decimal(10,2). |
| `ref` | `status` | **Global (untenanted) table.** `status_code` PK, `label`. |
| `billing` | `agency_revenue` (view) | Per `agency_id`: `order_count` and `paid_total`. |

Rows: 3 agencies, about 8 programs, about 24 clients (several with a NULL `ssn`), about 36 enrollments, about 45 orders and about 100 order lines. The data deliberately includes:

- NULLs in every nullable column;
- decimals with trailing zeros, such as `12.50`;
- timestamps near midnight UTC;
- a leap-day date;
- accented Latin and CJK text.

The data contains no values that differ only by case. MySQL, MariaDB and SQL Server compare strings case-insensitively by default, so a unique constraint on such values would fail there.

**Multiple schemas per engine:**

| Engine | How logical schemas map |
|---|---|
| Postgres, SQL Server | Real schemas: `org`, `people`, `billing`, `ref`. |
| MySQL, MariaDB | Every table in one database, `askdb_lab`. AskDB's MySQL connector introspects only the connection's database (`DATABASE()`) and renders it as namespace `public` (`packages/mysql/src/connector/describe.ts`). One database is therefore the layout AskDB supports, and the common one for MySQL users. (Changed during Phase 1 from one database per logical schema, which would have left three of the four invisible to introspection.) |
| SQLite | Only one schema, `main`, which AskDB also renders as `public`. |

Table names are unique across logical schemas, so everything fits in one namespace on the flattened engines. Normalization maps each table back to its logical schema through `dataset/schema.logical.json`.

### Sources and files

```
examples/consumer-lab/dataset/
  schema.logical.json    # golden logical schema: tables, columns, logical types, nullability, PKs,
                         # FKs (composite, ordered), unique constraints, views, tenant + sensitive tags
  data/*.json            # one file per table; rows as JSON with logical values (ISO dates, decimal strings)
  ddl/postgres.sql       # hand-written DDL per dialect (plus roles, grants, optional RLS)
  ddl/mysql.sql
  ddl/mariadb.sql        # starts as a copy of mysql.sql; kept separate so MariaDB drift is visible
  ddl/sqlserver.sql
  ddl/sqlite.sql
  NORMALIZATION.md       # the type-normalization rules below, with the rationale for each
```

### One seeder

The seeder is `src/seed.ts`. It uses `pg`, `mysql2`, `mssql` and `better-sqlite3` directly, never AskDB. It:

1. Reads `data/*.json`.
2. Applies each dialect's DDL.
3. Inserts the rows with driver parameters, in FK order.
4. Writes a `lab_meta(dataset_hash, seeded_at)` row.

**Idempotency:** when the stored `dataset_hash` matches the hash of the DDL plus the data files, the seeder does nothing. Otherwise it drops and recreates the lab objects. The seeder does not verify its own work: `test/dataset.test.ts` is the one owner of that check. It reads every table back as `lab_reader` and compares it, after normalization, with the JSON, and runs first in `lab:matrix`.

In Phase 4 the seeder also creates a **scratch** database (or schema) per engine: a writable, throwaway copy that the safety suite uses to prove statements are dangerous. See [Scenario matrix](#scenario-matrix).

### Type-normalization rules

These rules are used both to compare introspected schemas and to compare result sets.

| Logical type | Postgres | MySQL / MariaDB | SQL Server | SQLite | Normalized **schema** type | Normalized **value** |
|---|---|---|---|---|---|---|
| `int` | `integer` | `int` | `int` | `INTEGER` | `int` | JS number → canonical integer string |
| `bigint` (counts) | `bigint` (pg returns a string) | `bigint` | `bigint` | `INTEGER` | `bigint` | canonical integer string |
| `decimal(p,s)` | `numeric(p,s)` (string) | `decimal(p,s)` (string) | `decimal(p,s)` (number) | declared `DECIMAL(p,s)`, stored as REAL/INTEGER | `decimal(p,s)` | decimal string with trailing zeros removed: `12.50`→`12.5`, `3.00`→`3` |
| `boolean` | `boolean` | `tinyint(1)` | `bit` | declared `BOOLEAN`, stored 0/1 | `boolean` | `true`/`false`. Applied only where the scenario declares the result column as `boolean`, because a MySQL `tinyint(1)` is indistinguishable from an integer at the driver level. |
| `date` | `date` | `date` | `date` | `TEXT` (ISO) | `date` | `YYYY-MM-DD`. The pg `date` parser is replaced so it returns the raw string, with no timezone shift. |
| `timestamp` (naive UTC) | `timestamp` | `datetime` | `datetime2(0)` | `TEXT` (ISO) | `timestamp` | `YYYY-MM-DDTHH:MM:SS`. The process runs with `TZ=UTC`. |
| `text(n)` | `varchar(n)` | `varchar(n)` (utf8mb4) | `nvarchar(n)` | `TEXT` | `text` (length ignored) | Unicode NFC |
| aggregates such as AVG | n/a | n/a | n/a | n/a | n/a | Rounded to 6 decimal places. Scenarios must avoid integer-average truncation (SQL Server's `AVG(int)`) by casting in the expected SQL. A mismatch is classed as a dataset/normalization issue, not a product bug. |

**Result-set rules:**

- Rows are compared as a multiset unless the scenario declares `ordered: true`. Ordered scenarios must `ORDER BY` a unique numeric key, because collations order strings differently across engines.
- Columns are compared by position. Column labels are ignored, since alias case differs by engine and by model.
- `NULL` stays `null`.
- Collations are the engine defaults, as a real user would have them. Questions that depend on case sensitivity are marked `dialectSensitive` and compared to a per-dialect expectation, not across dialects.

**Schema-comparison rules** (introspection suite):

- Compare tables, columns, normalized types, `nullable`, `primaryKey`, and relationships (`from`/`to` column ids, compared as ordered lists per composite FK).
- Identifiers are compared case-insensitively. They are mapped to logical schemas as described above.
- **Not comparable today.** Schema v2 has no unique constraints, indexes or view marker: views render as ordinary `tables[]` entries (see `packages/introspect/src/render/render.ts`, `toV2View`). The golden file keeps those facts for DDL review, but the comparison skips them. Each skipped fact is listed in the matrix output as `n/a (not in Schema v2)` so it stays visible.
- View column `nullable` is ignored. Engines disagree on it, and Postgres reports every view column as nullable.

## Compose layout

The lab uses one file, `examples/consumer-lab/compose.yml`, with project name `askdb-lab`.

| Service | Image (pinned tag) | Host port | Notes |
|---|---|---|---|
| `postgres` | `postgres:17` | **15432** | Healthcheck `pg_isready`. Roles: `lab_owner` (seeding and scratch), `lab_reader` (`SELECT` only, `default_transaction_read_only=on`), and `lab_tenant` (subject to RLS; optional). |
| `mysql` | `mysql:8.4` (LTS) | **13306** | Healthcheck `mysqladmin ping`. `lab_reader` has `SELECT` on the four databases only. |
| `mariadb` | `mariadb:11.4` (LTS) | **13307** | Healthcheck `healthcheck.sh --connect --innodb_initialized`. `lab_reader` as for MySQL. |
| `sqlserver` | `mcr.microsoft.com/mssql/server:2022-CU<n>-ubuntu-22.04` (pinned CU) | **11433** | Healthcheck `sqlcmd … SELECT 1`. `platform: linux/amd64`, which runs under Rosetta on Apple Silicon. The `lab` database is created by the seeder, not by hand. `lab_reader` login is in `db_datareader`, with explicit `DENY` on writes. |
| `verdaccio` | `verdaccio/verdaccio:6` | **14873** | Behind the `registry` compose profile, so it only runs for install mode (c). |

- SQLite is a file, `examples/consumer-lab/.data/lab.sqlite`, created by the seeder. The app opens it read-only (`readonly: true` plus `PRAGMA query_only`).
- None of these ports clash with 5432, 5433, 5434, 3306 or 1433.
- Data lives in named volumes.

**Commands** (root `package.json`, all delegating into the lab directory):

- `pnpm lab:up`: `docker compose up -d --wait`, then the seeder. Idempotent.
- `pnpm lab:down`: `docker compose down`. Keeps the volumes.
- `pnpm lab:reset`: `down -v`, deletes `.data/`, then `lab:up`.

**Postgres row-level security** (optional): an RLS policy on the tenant tables filters on `current_setting('lab.agency_id')` for the `lab_tenant` role. It is used for one defense-in-depth scenario that shows what `run-safely-in-prod.mdx` and `how-askdb-works.mdx` recommend. It is not required for the AskDB tenant tests to pass.

## Consumer app

### Structure

```
examples/consumer-lab/
  compose.yml
  dataset/                  # see Dataset
  package.json              # private; third-party deps pinned exactly; @askdb/* specs written by lab:use
  pnpm-workspace.yaml       # makes this a standalone pnpm root: allowBuilds for better-sqlite3, no parent workspace
  pnpm-lock.yaml            # the app's own lockfile
  askdb.config.ts           # generated per dialect/test into temp dirs; this committed one is for `lab ask`
  scenarios/
    questions.json          # id, text, dialect coverage, result types, ordered?, oracle id
    safety.json             # attack SQL cases (see matrix)
    overlay/                # authored artifact files applied after introspection: tenant-policy.md, sensitive marks
  cassettes/<dialect>/<question-id>.json   # recorded model replies
  src/
    use.mjs                 # install-mode switcher (no dependencies; runs before install)
    seed.ts                 # seeder (drivers only)
    host/execute.ts         # read-only execution per dialect, following run-safely-in-prod.mdx
    host/normalize.ts       # normalization rules above
    oracle.ts               # expected answers computed in JS from dataset/data/*.json
    model/replay-server.ts  # OpenAI-compatible replay/record server (see Model)
    lab-cli.ts              # `pnpm lab ask …`
    matrix-reporter.ts      # vitest reporter → dialect × scenario table
  test/
    introspection.test.ts
    results.test.ts
    safety.test.ts
    tenant.test.ts
    sensitive.test.ts
    surfaces/cli.test.ts
    surfaces/http-api.test.ts
    surfaces/studio.test.ts
```

**Keeping it out of the workspace.** `pnpm-workspace.yaml` globs `examples/*`, so the root file gains `- "!examples/consumer-lab"`. The lab directory also has its own `pnpm-workspace.yaml`, so pnpm treats it as a separate root and never links `workspace:` packages into it.

**Public exports only.** The app is written from the docs site:

| Area | What the app uses |
|---|---|
| Core | `ask`, `loadSchema`, error classes and predicates, `validateSensitiveReferences` and `bindPreparedQuery` from `@askdb/core` |
| Client | `createAskDb` from `@askdb/client` with `@askdb/ai-openai` |
| Raw model | a `LanguageModel` built with `createOpenAI` from `@ai-sdk/openai`. This keeps the adapter path and the raw-model path equally covered, per AGENTS.md. |
| HTTP API | `createAskDbHttpServer` and the `askdb-http` bin |
| CLI and Studio | the `askdb` bin |

Deep imports are impossible because of the packages' `exports` maps. Code review enforces the docs-only rule; there is no copied export allowlist (that would be a test-audit junk pattern).

**Introspection goes through the CLI.** The docs site only documents programmatic introspection for Prisma, so the app introspects every engine with `askdb introspect --engine <e> --url …`. SQLite uses `introspection.providerConfig.sqlite.file` in config. MariaDB uses `--engine mysql` and is paired with the `mariadb` dialect.

**Execution follows the operator checklist.** The host executes as the read-only role, with a statement timeout and a row cap, as in `guides/run-safely-in-prod.mdx`. It uses the drivers directly: `pg`, `mysql2`, `mssql`, `better-sqlite3`. It never uses AskDB-internal runners.

### Install modes

One command switches the mode: `pnpm lab:use <target>`. It writes the `@askdb/*` specs into the app's `package.json`, writes a matching `pnpm.overrides` block, runs `pnpm install` in the app, and prints a resolved-version table.

**Why overrides:** without them, a tarball of `@askdb/client` depends on `@askdb/core@<range>`, and that transitive dependency would resolve from the npm registry instead of from the checkout under test. After every switch, `lab:use` checks that each installed `@askdb/*` package resolves to the target.

| Target | Meaning |
|---|---|
| `.` or `<path>` | **(a) Tarballs from a checkout.** Build that checkout and pack every publishable package into `.lab/tarballs/`. |
| `git:<ref>` | **(a) Tarballs from a branch or commit.** Create a temporary `git worktree` at `<ref>`, install, build and pack there, then remove the worktree. |
| `npm:<dist-tag>` | **(b) Published dist-tag.** For example `npm:beta` or `npm:latest`. Every `@askdb/*` package is set to that tag. |
| `npm:askdb@<version>` | **(b) Published version.** Package versions are not in lockstep (`@askdb/core` is at 1.0.0-beta.42 while `@askdb/mysql` is at 0.1.0-beta.17). So "a version" means a CLI release, and the matching version of every other package comes from that release's published dependency tree (`npm view`). |
| `registry` | **(c) Local verdaccio registry.** Start the `registry` profile, `pnpm publish` the packed tarballs to it, and install from it with `--registry`. This also exercises publish-time rewriting such as `workspace:` → versions and `publishConfig`. |

**Reuse.** The packing step moves out of `examples/installable-smoke/run.sh` into `scripts/pack-tarballs.sh`, which both the smoke test and the lab call. The smoke test's hardcoded package list becomes discovery of every non-private `packages/*` and `apps/*` package. That fixes the smoke test's current gap, where `@askdb/http-api` is packed but never assigned or installed. The smoke test's tarball-content assertions stay as they are.

**Lockfile policy** (decision 2): commit `package.json` and `pnpm-lock.yaml` in the `npm:beta` state, which is the published baseline. `lab:use` changes them locally. CI always runs `lab:use .` and does not use a frozen lockfile, because tarball integrity hashes change on every pack. Third-party dependencies are pinned exactly in `package.json`, so they don't drift between modes.

**Older versions.** A scenario may name the documented capability it needs, for example `parameterize`. When an older target lacks it, the matrix prints `n/a (capability)` for that scenario instead of failing. Capabilities are detected through public exports or documented CLI `--help` output, not version strings.

### `pnpm lab ask`

```
pnpm lab ask --db postgres "How many active programs does each agency run?"
             [--model replay|live] [--sql "<sql>"] [--tenant 2] [--strict] [--omit-sensitive]
```

It prints:

1. the SQL, plus `unboundSql` and `params` when present;
2. the validation result: `ok`, or the thrown error's class and rule code, such as `SqlValidationError SQL_MULTI_STATEMENT`;
3. `sensitiveGuardrail` and `tenantGuardrail`, when present;
4. the rows, executed as `lab_reader` and printed as a table;
5. the oracle's verdict, when the question is in the catalog.

Flags:

- `--model` defaults to `replay`. It switches to `live` when `LAB_LIVE_MODEL=1` and a provider key is set.
- `--sql` bypasses the model through `deps.generateText`, which the docs name as the mock seam.

## Model

### Replay server (CI)

`src/model/replay-server.ts` is a small OpenAI-compatible HTTP server. It implements non-streaming `POST /v1/responses` and `/v1/chat/completions`.

- **In-process tests** point `createOpenAI({ baseURL })` (the raw-model path) or `@askdb/ai-openai` via config `providerConfig.openai.baseUrl` (the adapter path) at the server. Both are documented.
- **CLI, HTTP API and Studio tests** use the same server through `askdb.config.ts`. That makes every surface run through the real provider wiring, with no special hooks.

**Routing:**

- **Dialect:** taken from the base URL path, `http://127.0.0.1:<port>/<dialect>/v1`. This works with any model id and in record mode.
- **Question:** found by matching the catalog's question texts, which are unique, inside the user prompt.
- **No match:** the server fails with an error that names the missing cassette and the `lab:record` command. It never falls back to a default.

**Cassettes** live at `cassettes/<dialect>/<id>.json`:

```json
{ "question": "…", "reply": "```sql\nSELECT …\n```", "source": "recorded|authored",
  "recordedWith": { "model": "…", "askdbTarget": "…", "at": "…" } }
```

- **Recorded** cassettes store the model's full reply, including the ```sql-unbound fence and the parameter manifest. The parameter-binding path is therefore exercised as a real model drives it.
- **Authored** cassettes are hand-written fixed SQL. They are used for adversarial safety cases and for tenant/strict negatives, where the "model" is deliberately the attacker.

**Prompt capture.** The server records the prompts it receives, and tests read them through `GET /__lab/requests`. The sensitive-column suite asserts on those prompts. This is a seam of the lab harness, not of production code.

### Record and live

- `pnpm lab:record [--db …] [--only <id>]` needs `OPENAI_API_KEY`, or another documented provider set through `LAB_LIVE_PROVIDER`. The server proxies to the real provider and writes or refreshes cassettes. Afterwards, the maintainer reviews the cassette diff in git before committing it.
- `LAB_LIVE_MODEL=1 pnpm lab:matrix` runs against the live model without writing anything. Cross-dialect equality and oracle checks still apply. Failures are reported as model quality, not product bugs, unless the SQL passed validation but violated a guarantee (tenant, sensitive, read-only).
- CI never sets either of these.

## Scenario matrix

Each scenario runs once per dialect: `postgres`, `mysql`, `mariadb`, `sqlserver`, `sqlite`. Every test is listed with the contract it protects (C) and the regression it catches (R).

### 1. Introspection

| Scenario | C / R |
|---|---|
| `askdb introspect` output for each database, after normalization, equals `schema.logical.json` | C: Schema v2 contract (`docs/contracts/schema-v2.md`) and CLI introspect. R: a lost composite FK order, a dropped nullable, a missing schema, a mis-mapped type, a view dropped by one engine, or a reserved-word table mangled. |
| The artifact loads with `loadSchema` and survives `askdb bundle` | C: artifact/bundle loading. R: renderer output that core can't parse. |

### 2. Question → SQL → execute

Twelve to fifteen catalog questions. Between them they cover:

- a cross-schema join and the composite-FK join;
- GROUP BY with decimal sums;
- date-range filters;
- boolean filters;
- `IS NULL`;
- a unicode equality match;
- the reserved-word table;
- the view;
- top-N ordered by a unique key;
- a LEFT JOIN that produces NULLs;
- `COUNT(DISTINCT)`;
- one parameterized literal.

| Scenario | C / R |
|---|---|
| `ask()` succeeds. Executing `sql` as `lab_reader` equals the oracle, and equals every other dialect after normalization | C: `ask()` returns executable, dialect-correct SQL (core pipeline plus dialect). R: validator false positives on valid dialect syntax (brackets, backticks, `TOP`, `OFFSET … FETCH`), extraction regressions, or a wrong dialect brief. |
| Binding `unboundSql` + `params` with the real driver returns the same rows as `sql`. Where documented, `bindPreparedQuery` is checked too | C: the parameterized output contract. R: markers the driver can't bind (`$N`, `?`, `@pN`), or values that are wrong or escaped wrongly. |
| The same question through `createAskDb` (adapter path) returns the same SQL as through `ask()` with a raw `LanguageModel` | C: both model paths are equally supported (AGENTS.md). R: config-driven dialect or model resolution drifting from direct `ask()`. |

### 3. Safety

Each case is a model reply (an authored cassette) that must be rejected. For every case, the suite asserts two things:

- `ask()` throws the documented error class and rule code;
- **the case is meaningful:** the raw statement, run as `lab_owner` against that engine's **scratch** database, does run and changes observable state (a row count, a new table, a sequence value, a held lock or an elapsed sleep). If the raw statement is harmless on an engine, the case is marked `n/a` for that engine. It never counts as a pass.

| Case family | Examples |
|---|---|
| Multiple statements | `SELECT 1; DELETE FROM …`, and a trailing statement after a string literal that contains `;` |
| Writes and DDL | `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `CREATE`, `ALTER`, `MERGE`, and a CTE-wrapped DML (`WITH x AS (DELETE … RETURNING *) SELECT …`) |
| Writes that start with SELECT | `SELECT … INTO new_table` (Postgres, SQL Server), `SELECT … INTO OUTFILE` (MySQL/MariaDB), `SELECT … FOR UPDATE` (lock) |
| Side-effecting functions | `nextval()`, `setval()`, `pg_advisory_lock()`, `pg_sleep()`, `set_config()`, `pg_terminate_backend()`, `GET_LOCK()`, `SLEEP()`, `BENCHMARK()`, `xp_cmdshell`, `EXEC`, `OPENROWSET` |
| Comment and quoting tricks | `/* */` and `--` hiding a second statement; keywords split by comments; `DELETE` inside `"…"`, `` `…` `` and `[…]` identifiers; `E'…'` and `N'…'` strings with embedded quotes; MySQL `/*! … */` executable comments; backslash-escaped quotes in MySQL |
| System catalogs | `pg_catalog`, `information_schema`, `mysql.user`, `sys.*`, `sqlite_master` (documented as rejected in `concepts/safety-boundaries.mdx`) |

There is also a false-positive control: the reserved-word table `billing.order` and the unicode data must *not* be rejected.

Defense in depth is reported but never counted as a pass: each case also records whether `lab_reader` would have blocked it anyway.

**Expected tension:** the validator in `packages/core/src/sql/validate.ts` is a keyword heuristic. Some of these cases, such as `SELECT … INTO` and `nextval()`, are likely to be accepted. Each accepted case goes to classification against the documented claims. It does not get a softened test.

### 4. Tenant scoping, by behavior

The overlay adds `tenant-policy.md`:

- root `org.agency` with tenant column `agency_id`;
- `scopedTables` for `program`, `client`, `enrollment`, `order` and `order_line` (the last through a join to `order`);
- `globalTables` for `ref.status`.

| Scenario | C / R |
|---|---|
| With `tenantScope { kind: "ids", tenantRoot, ids: [2] }`, every scoped question's executed rows equal the oracle filtered to agency 2, on every dialect, in both `tenantSqlMode`s | C: `docs/contracts/tenant-policy.md` and `guides/multi-tenancy.mdx` ("the tenant predicate is present in the SQL AskDB returns"). R: placeholder substitution or markers wrong per dialect, or a predicate on the wrong alias. |
| Strict mode: a reply with no tenant filter is rejected with `TenantGuardrailError`. The same SQL, executed raw, returns rows from other tenants, which proves the case is meaningful | C: strict fail-closed. R: the guardrail missing an unfiltered scoped table. |
| A reply with a filter on the wrong tenant, or `OR 1=1` around the predicate, is rejected in strict mode | C: the predicate must be provable. R: the heuristic accepting a present-but-ineffective filter. |
| No `tenantScope` with a policy present gives `TenantScopeError` `MISSING_SCOPE` | C: fail closed before the prompt. |
| Warn mode returns SQL and warnings, as documented | C: documented warn semantics. Recorded against the "can't be forgotten" claim (see Survey notes). |
| (Optional, Postgres) The unfiltered SQL, run as `lab_tenant` with RLS, returns only agency 2 | Documents the defense-in-depth recommendation. Informational only. |

### 5. Sensitive columns

The overlay marks `people.client.email` and `people.client.ssn` as `sensitive: true` in `schema.json`. That is the only source of the flag the contract honors.

| Scenario | C / R |
|---|---|
| Default: the captured prompt contains `ssn` tagged `(sensitive)` | C: `docs/contracts/sensitive-fields-and-modes.md`. R: tagging lost. |
| With `omitSensitiveIdentifiersFromNlToSqlPrompt`, the CLI flag `--omit-sensitive-from-prompt`, or HTTP `omitSensitiveFromPrompt`, the captured prompt contains neither identifier | C: prompt exclusion on every surface. R: one surface not forwarding the option. |
| A reply that reads `ssn` gets `sensitiveGuardrail.passed === false` with the right references (`warn`), and `SensitiveReferenceError` `SENSITIVE_COLUMN_REFERENCED` (`strict`); `SELECT *` from `client` is flagged too | C: documented flagging. R: the heuristic missing qualified, aliased, `*` or quoted references per dialect quoting style. |

### 6. Black-box surfaces

| Surface | Scenarios |
|---|---|
| `askdb` CLI | **`introspect`**: covered by suite 1, plus exit codes. **`ask`**: SQL on stdout; the sensitive `Warning:` on stderr; `--mock-sql`; exit codes 0/1/2 as documented in `reference/cli.mdx`. |
| `@askdb/http-api` | **`POST /ask`**: 200 shape `{ ok, correlationId, sql, … }`. **Documented error codes**: `bad_request` 400, `payload_too_large` 413, `schema_parse_error` 400, `sql_validation_error` 400 (safety cases over HTTP), `sql_generation_error` 502 (replay server returns 500), `generation_not_configured` 500, `not_found` 404. Also `x-correlation-id` echo and `GET /health`. Transport risk the in-process tests can't reach. |
| Studio local API | Each case follows ADR 0009 and `studio.mdx`: 403 without `x-askdb-studio-token`, 403 with a foreign `Host` (rebinding), 403 with a cross-site `Origin`, 415 for `text/plain`, and the token readable from the served page. **Execute:** with `studio.execute` configured, `/api/execute` returns rows for a SELECT. Given `lab_owner` credentials on the **scratch** database, it still refuses a write and a multi-statement, which tests ADR 0009's "single-statement, read-only, with timeouts and row caps" claim; the scratch DB proves the write would otherwise land. |

## Commands and reporting

- `pnpm lab:matrix` runs `lab:up` (idempotent), then the whole vitest suite, with `src/matrix-reporter.ts`. The reporter prints a `scenario × dialect` table with the values `pass`, `FAIL`, `n/a (reason)` and `known (discrepancy id)`. It also writes `.lab/matrix.json`. In CI the table is appended to `$GITHUB_STEP_SUMMARY`.
- Test names encode `[dialect] scenario-id`, which is how the reporter builds the table. `--db` and `--only` filters pass through to vitest.
- **Known discrepancies** live in `examples/consumer-lab/DISCREPANCIES.md`, with an id, a classification (product bug / dataset-normalization / test issue), the docs quote, the observed behavior and a linked issue or PR. A test for an open product bug is marked `it.fails` with the discrepancy id. When the bug is fixed, `it.fails` starts failing and forces the marker to be removed. The matrix shows `known (D-07)` rather than green.

## CI plan

Add a new `consumer-lab` job to `.github/workflows/ci.yml`. It needs `build`, has `timeout-minutes: 25`, and targets about 12 minutes.

1. Checkout, then set up pnpm and Node 22, then restore the turbo cache. These steps are the same as the existing jobs.
2. `docker compose -f examples/consumer-lab/compose.yml up -d --wait`. It uses compose rather than job `services:` because MariaDB, the roles and the pinned images must match local runs exactly. It starts in the background while the next steps run.
3. `pnpm lab:use .`, which packs through the shared `scripts/pack-tarballs.sh` and installs into the lab app.
4. `pnpm lab:matrix`. Lab suites never skip: a missing database fails the run. The repo's `integrationSuite()` helper isn't used because it imports the monorepo's own vitest, and the lab has a separate install.
5. Upload `.lab/matrix.json` and the summary table as an artifact.

**Budget:**

| Step | Estimate |
|---|---|
| Image pulls | about 2–3 minutes. SQL Server's is the largest image, pulled in parallel. |
| SQL Server start | about 60 seconds |
| Pack and install | about 2 minutes on a warm turbo cache |
| Suite | about 3 minutes |

Recommended additions (decision 4):

- A **nightly** scheduled run with `lab:use npm:beta`. It catches publish-only drift: files missing from tarballs, or a bad `workspace:` rewrite.
- A **path filter**, so pull requests that only touch `apps/docs-site` skip the lab.

## Test-audit compliance

Every test file starts with a header comment answering the four authoring-gate questions:

1. the contract it protects;
2. the regression it catches;
3. why existing coverage misses it (the distinct risk: packed artifacts, real engines, real drivers, cross-dialect agreement, or transport);
4. that it needs no production seam.

Seams the lab itself uses: the replay server and prompt capture are lab code. `deps.generateText` and `--mock-sql` are documented public seams.

**Proof of failure.** Each PR description has a "break it" table: the temporary source change made in the checkout, the command (`pnpm lab:use . && pnpm lab:matrix --only <id>`), and the failing output. For example, removing `"delete"` from `BASE_FORBIDDEN` must turn the matching safety cases red; hardcoding `$N` markers must turn MySQL/SQL Server binding red. The change is then reverted. Negative controls must fail for the intended reason: each safety case asserts the rule code, not only that something was thrown.

**Avoiding duplicates.** The lab does not replay unit-level cases the core validator tests already own, such as tokenizer edge cases. Its safety cases are the ones where engine behavior matters: whether the raw statement actually does damage on that engine.

## Phased PR breakdown

| Phase | PR | Contents | Done when |
|---|---|---|---|
| 1 | Dataset, compose, seeder | `dataset/`, `compose.yml`, `ddl/*`, `src/seed.ts`, `NORMALIZATION.md`, the lab `package.json` (drivers and vitest only) excluded from the workspace, root `lab:up/down/reset`. One suite (`test/dataset.test.ts`): every engine's rows, read as `lab_reader`, equal the JSON after normalization; the view matches an oracle; `lab_reader` cannot write. | `pnpm lab:reset` is green locally on Apple Silicon and on Linux. |
| 2 | Consumer app, install modes, `lab ask` | `scripts/pack-tarballs.sh` (the smoke test switches to it), `src/use.mjs` with `.`/`git:`/`npm:` targets and the resolved-version check, `host/execute.ts`, `host/normalize.ts`, `oracle.ts`, the replay server with authored cassettes, `pnpm lab ask`. | `pnpm lab ask --db <each>` prints SQL, validation and rows. `pnpm smoke:install` is still green. |
| 3 | Introspection and result equivalence | Suites 1 and 2, `lab:record`, the first recorded cassettes, and the matrix reporter skeleton. | Those rows are green or have a filed discrepancy on all five dialects. |
| 4 | Safety, tenant, sensitive | Suites 3–5, the scratch-database proofs, the policy/sensitive overlay, and the optional RLS scenario. | Every rejection is proved meaningful. Discrepancies are filed. |
| 5 | CLI, HTTP API, Studio | Suite 6. | Documented codes and protections are covered. |
| 6 | CI, `lab:matrix`, docs | The CI job and optional nightly, the final reporter, a "Consumer lab" section in `CONTRIBUTING.md`, and `verdaccio` mode `(c)`. The `consumer-lab` skill. | The CI job is green within budget. |

Every phase runs `pnpm smoke:install` and `pnpm preflight` before its PR. None of the phases changes a publishable package, so they need no changeset. Product bugs the lab finds go into their own PRs with changesets, after the failing lab test has landed.

## Survey notes: inconsistencies to confirm with the lab

These came up while reading the docs. They are not findings yet: each one is either confirmed by a lab test in its phase or dropped.

1. `docs/specs/studio.md` lists live SQL execution as out of scope. ADR 0009, `studio.mdx` and `apps/studio/src/server.ts` (`/api/execute`) all say Studio executes SQL. The docs site does not document execute as read-only; only ADR 0009 does, in one line.
2. `docs/specs/http-api.md` describes `{ sql, warnings, correlationId }` with errors `{ error: { code, message, details } }`. The docs site shows `{ ok, correlationId, sql, explain, usage }` and a code list. The docs-site error example uses `rule: "read_only"`, but core rule codes are `SQL_*`.
3. `POST /ask` has no `tenantScope` field, while `tenant-policy.md` lists the HTTP API as a scope-input surface. By the core rules, a tenant-policy schema served over HTTP should fail closed with `MISSING_SCOPE`.
4. `guides/multi-tenancy.mdx` says the tenant predicate "can't be forgotten … and can't be removed by a malformed question", but `enforcement: warn` returns unfiltered SQL with warnings.
5. `concepts/safety-boundaries.mdx` says invalid SQL is "rejected, not returned with a warning", while the default sensitive-field mode is `warn`.
6. Schema v2 has no unique constraints and no view marker, so the introspection golden can't compare them. This is a format limit, not a bug, but the lab's matrix will show it.
7. The docs site names `POSTGRES_DIALECT` and `MYSQL_DIALECT` but never the MariaDB, SQLite or SQL Server constants, and it says "all four" dialects while listing six ids. The lab uses the string ids.
8. The docs site documents programmatic introspection only for Prisma, so the lab has no documented way to introspect Postgres, MySQL, SQLite or SQL Server from code. It uses the CLI.
9. There is no MariaDB fixture or test anywhere in the repo today, although `mariadb` is a built-in dialect.
10. `docs/specs/multi-tenancy.md` uses different front-matter keys from `docs/contracts/tenant-policy.md` (`tableId` and `tenantColumn` versus `id` and `tenantIdColumn`, among others). The lab follows the contract.

## Decisions (2026-09-26)

1. **Location:** `examples/consumer-lab/`, excluded from the workspace with `!examples/consumer-lab`.
2. **Lockfile:** the app's `package.json` and `pnpm-lock.yaml` are committed in the `npm:beta` baseline state.
3. **MySQL:** `mysql:8.4` LTS.
4. **CI:** the lab runs on every PR (docs-only PRs are skipped by a path filter), plus a nightly run against `npm:beta`. A repo skill, `.agents/skills/consumer-lab/`, drives target selection: it works out the right `lab:use` target (a tarball from the checkout, a `git:` ref, a published version or dist-tag), refreshes the committed baseline when a new beta ships, and runs and reads the matrix.
5. **Cassettes:** the first pass uses authored SQL only. Recording with a live key is optional and is done by the maintainer.
6. **Docs:** the lab is documented in `CONTRIBUTING.md` only; there is no docs-site page.
