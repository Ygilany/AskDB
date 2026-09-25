# Plan 061: Run each live introspection on one catalog session — one connection, a consistent snapshot where the engine offers one, a statement timeout, and leak-free cleanup

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
> 1. Prerequisites merged: `for n in 189 195 199; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done` → `MERGED` three times.
> 2. The kit exists: `git grep -n "export function createOptionalDriverLoader" packages/introspect/src/kit/driver.ts` → one match; `git grep -n "defineLiveConnectorProvider" packages/introspect/src/kit/index.ts` → one match.
> 3. The problem still exists: `git grep -n "new pgRuntime.Pool" packages/postgres/src/exec/postgres.ts` → one match; `git grep -n "await Promise.all" packages/mysql/src/connector/describe.ts packages/sqlserver/src/connector/describe.ts packages/sqlite/src/connector/describe.ts` → three matches; `git grep -n "openSession\|CatalogSession" packages/` → no matches.
> 4. Recommended but not required: plan 063 (deeper live fixtures) has landed, so the MySQL/SQL Server/SQLite rewrites below run against real composite-FK/view schemas in CI. Check `plans/README.md`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — every live introspection path changes how it talks to the driver.
- **Depends on**: PRs #189, #195, #199 (merged). Soft: plan 063 first (safety net). Conflicts: plan 064 and plan 062 also edit `packages/postgres/src/connector/describe.ts` — run sequentially, not in parallel.
- **Category**: bug / perf
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No. `CatalogQueryRunner` gains an *optional* `openSession` property; the runner factories gain optional options. BYO runners without `openSession` behave exactly as today.

## Why this matters

Live introspection reads the catalog with many independent queries, and each built-in runner opens a fresh connection per query. Postgres builds a new `pg.Pool` for each of 12 sequential templates; MySQL, SQL Server and SQLite fire 5–6 queries concurrently, each on its own connection. Consequences: (1) the results are not a consistent snapshot — a migration running during introspection can produce an artifact where `columns` and `foreign_keys` disagree; (2) 6–13 connection handshakes per run, which hurts poolers (PgBouncer/RDS Proxy) and connection-limited roles; (3) no statement timeout, so a lock or a pathological catalog stalls `askdb introspect` forever; (4) on Postgres and SQL Server, `pool.connect()` sits outside the `try`, so a failed connect never closes the pool. After this plan, each `describe*()` call uses exactly one connection, Postgres reads a `REPEATABLE READ READ ONLY` snapshot with `statement_timeout`, and every failure path releases the connection.

## Current state (verified on c7404d4)

- `packages/postgres/src/exec/postgres.ts` — `runPostgresCatalogQuery`, a pool per query, connect outside `try`:
  ```ts
  const pool = new pgRuntime.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    ...
    await client.query("COMMIT");
  } catch (e) { try { await client.query("ROLLBACK"); } catch { /* ignore */ } ... }
  finally { client.release(); await pool.end(); }
  ```
- `packages/postgres/src/connector/describe.ts` — `describePostgres` runs 12 templates sequentially through `input.runner`: `const schemasRows = await run<SchemasRow>("schemas"); … const commentRows = await run<CommentsRow>("comments");`.
- `packages/mysql/src/exec/mysql.ts` — `runMysqlCatalogQuery` does `mysql.createConnection(connectionString)` then `connection.end()` per query; no timeout. `packages/mysql/src/connector/describe.ts` — `describeMysql` runs `SQL_CURRENT_DATABASE`, then `await Promise.all([run(SQL_TABLES), run(SQL_COLUMNS), run(SQL_CONSTRAINTS), run(SQL_FOREIGN_KEYS), run(SQL_INDEXES), run(SQL_VIEWS)])` — 7 connections, 6 concurrent.
- `packages/sqlserver/src/exec/sqlserver.ts` — `runSqlServerCatalogQuery`: `const pool = new mssql.ConnectionPool(resolveConnectionInput(connectionString) as never); await pool.connect(); try { … } finally { await pool.close(); }` — connect outside `try`. `describeSqlServer` uses `Promise.all` over 6 queries.
- `packages/sqlite/src/exec/sqlite.ts` — `runSqliteCatalogQuery` opens `new Database(filename, { readonly: true, fileMustExist: true })` per query. `describeSqlite` uses `Promise.all` over 5 queries.
- `packages/introspect/src/types.ts` — the public port: `export type CatalogQueryRunner = (sql: string, params?: ReadonlyArray<unknown>) => Promise<CatalogQueryResult>;`
- `packages/introspect/src/kit/index.ts` — shared engine helpers (driver loader, filters, ids, rows, `defineLiveConnectorProvider`, redaction). The natural home for a session helper.
- Test gap: `packages/postgres/src/exec/postgres.lazy.test.ts` fakes `pg` only to test driver resolution; nothing asserts `BEGIN READ ONLY`, the connection count, or cleanup on failure.
- Exemplar to match for timeouts and cleanup: Studio's `apps/studio/src/execute-registry.ts` — `executePostgres` (`new pgMod.Client({ connectionString, connectionTimeoutMillis, query_timeout })`, `BEGIN READ ONLY`, `` SET LOCAL statement_timeout = ${timeoutMs} ``, `client.end().catch(() => {})` in `finally`) and `applyMysqlTimeout` (`SET SESSION MAX_EXECUTION_TIME`, falling back to MariaDB's `max_statement_time` in seconds).

Engine facts that bound what "consistent snapshot" can mean (put these in code comments):
- **Postgres**: plain `SELECT`s on `pg_catalog` use the transaction snapshot, so `REPEATABLE READ` makes the 12 templates agree. Helper functions (`format_type`, `pg_get_expr`, `pg_get_viewdef`, `pg_get_constraintdef`) read the catalog cache and may see newer state — the same caveat `pg_dump` documents.
- **SQLite**: a `BEGIN` (deferred) read transaction on one handle is a true snapshot.
- **MySQL/MariaDB**: `information_schema` is not MVCC-consistent; one connection plus a timeout is the improvement. Do not claim a snapshot.
- **SQL Server**: catalog views are not versioned under snapshot isolation; one connection plus a timeout is the improvement. Do not claim a snapshot.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install / build | `pnpm install && pnpm build` | exit 0 |
| Typecheck | `pnpm lint` | exit 0 |
| One package's tests | `pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/exec` | all pass |
| All tests | `pnpm test` | exit 0 (integration suites skip unless URLs are set) |
| Integration (optional locally) | set `DATABASE_URL`, `PAGILA_DATABASE_URL`, `MYSQL_DATABASE_URL`, `MSSQL_DATABASE_URL` per CONTRIBUTING.md "Integration Tests", then `ASKDB_REQUIRE_INTEGRATION=1 pnpm test` | all pass |
| Docs | `pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Suggested executor toolkit

- Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`) to every test you add.

## Scope

**In scope**:
- `packages/introspect/src/types.ts`, `packages/introspect/src/index.ts`, `packages/introspect/src/kit/session.ts` (create), `packages/introspect/src/kit/session.test.ts` (create), `packages/introspect/src/kit/index.ts`
- `packages/{postgres,mysql,sqlserver,sqlite}/src/exec/*.ts` (runner files and their `*.lazy.test.ts` driver fixtures), and a new `*.session.test.ts` per engine (mocked driver) where named below
- `packages/{postgres,mysql,sqlserver,sqlite}/src/connector/describe.ts` — only the query-issuing code at the top of each `describe*()`; fold functions untouched
- `packages/postgres/src/exec/postgres.integration.test.ts`, `packages/sqlite/src/exec/sqlite.integration.test.ts` (extend)
- Docs: `docs/integration/connectors.md` ("Live execution: `CatalogQueryRunner`"), `docs/specs/introspection.md`, `apps/docs-site/src/content/docs/reference/packages.mdx` (only if it describes runner behavior after your change)
- `.changeset/catalog-session-runner.md` (create)

**Out of scope**:
- Any `fold*Result` function, catalog SQL text, or template list — this plan changes transport, not what is read.
- Studio's `apps/studio/src/execute-registry.ts` — separate concern (executing user SQL); do not share code with it in this plan.
- A config key / CLI flag for the timeout. The factory option is enough for now; wiring `askdb.config` is a follow-up.
- `--from-export` bundle mode and `@askdb/prisma` (no live connection).

## Git workflow

- Branch `plan/061-session-scoped-catalog-runner`; one PR; do not merge. Conventional commits, e.g. `feat(introspect): session-scoped catalog runner`, `fix(postgres): one connection per introspection`.

## Steps

### Step 1: Add the session port (types + kit helper)

In `packages/introspect/src/types.ts`, keep the call signature and add an optional session opener:

```ts
export type CatalogSession = {
  /** Runs one catalog query on the session's single connection. */
  query: (sql: string, params?: ReadonlyArray<unknown>) => Promise<CatalogQueryResult>;
  /** Ends the session and releases the connection. Idempotent; never rejects. */
  close(): Promise<void>;
};

export type CatalogQueryRunner = ((sql: string, params?: ReadonlyArray<unknown>) => Promise<CatalogQueryResult>) & {
  /** When present, connectors run a whole describe() on one session instead of one connection per query. */
  openSession?: () => Promise<CatalogSession>;
};
```

Export `CatalogSession` from `packages/introspect/src/index.ts`. Create `packages/introspect/src/kit/session.ts` exporting:
- `DEFAULT_CATALOG_STATEMENT_TIMEOUT_MS = 60_000`
- `type CatalogRunnerOptions = DriverLoadOptions & { statementTimeoutMs?: number }` — `0` disables the timeout; negative or non-integer values throw a `TypeError` at factory time.
- `withCatalogSession<T>(runner: CatalogQueryRunner, fn: (query: CatalogSession["query"]) => Promise<T>): Promise<T>` — if `runner.openSession` is absent, return `fn(runner)`. Otherwise open once, call `fn(session.query)`, and `close()` in `finally`. If `fn` rejects, rethrow *that* error even when `close()` fails.
- `defineSessionCatalogRunner(open: () => Promise<CatalogSession>): CatalogQueryRunner` — returns a function that, for a one-off call, opens a session, runs one query, closes it; and sets `openSession = open` on the function.

Re-export all four from `packages/introspect/src/kit/index.ts`.

**Verify**: `pnpm --filter @askdb/introspect build && pnpm --filter @askdb/introspect lint` → exit 0.

### Step 2: Postgres session

Rewrite `packages/postgres/src/exec/postgres.ts` around a session opener built with `defineSessionCatalogRunner`:
- Use `new pgRuntime.Client({ connectionString, query_timeout: timeout > 0 ? timeout + 2_000 : undefined })` instead of a `Pool` (one connection is the goal; no pool to leak).
- `await client.connect()` **inside** the `try`; on any failure call `client.end().catch(() => {})` and throw `AskDbError("PostgreSQL catalog query failed: <message>", cause)` (keep the existing message prefix — callers and tests match it).
- After connect: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, then (when timeout > 0) `` SET LOCAL statement_timeout = ${timeout} `` with `timeout` validated as a non-negative integer.
- `query(sql, params)` maps results exactly as today (`fields` → `columns`, rows by field name).
- `close()`: `COMMIT` if no query failed, otherwise `ROLLBACK` (both best-effort), then `client.end()`; idempotent via a `closed` flag; never rejects.
- `createPostgresCatalogQueryRunner(connectionString, options?: CatalogRunnerOptions)` — same name, widened options type (it is a superset of `DriverLoadOptions`).

Then in `describePostgres` (`packages/postgres/src/connector/describe.ts`) wrap the 12 `run(...)` calls in `withCatalogSession(input.runner, async (query) => { … })`, keeping them **sequential** and in the current order.

Update `packages/postgres/src/exec/postgres.lazy.test.ts`'s `addPgFixture` so the fake `pg` module also exports a `Client` class (`connect`, `query` returning `{ fields, rows }`, `end`); the existing two tests must pass unchanged otherwise.

**Verify**: `pnpm --filter @askdb/postgres build && pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src` → all pass.

### Step 3: MySQL/MariaDB, SQL Server, SQLite sessions

Same pattern per engine, each via `defineSessionCatalogRunner`, each factory widened to `CatalogRunnerOptions`:
- **MySQL** (`packages/mysql/src/exec/mysql.ts`): one `createConnection` per session. After connect, apply the timeout exactly like Studio's `applyMysqlTimeout` (try `SET SESSION MAX_EXECUTION_TIME = <ms>`, fall back to `SET SESSION max_statement_time = <seconds>`, ignore if neither exists). `close()` → `connection.end()`, falling back to `connection.destroy()` if `end` rejects. In `describeMysql`, run `SQL_CURRENT_DATABASE` and then the six queries **sequentially** inside `withCatalogSession` (delete the `Promise.all`).
- **SQL Server** (`packages/sqlserver/src/exec/sqlserver.ts`): build the config object — if `resolveConnectionInput(...)` returns a string, convert it with `mssql.ConnectionPool.parseConnectionString(str)` (the static the `ConnectionPool` constructor itself uses for strings) — then `new mssql.ConnectionPool({ ...config, pool: { min: 0, max: 1 }, requestTimeout: timeout > 0 ? timeout : 0 })`. `await pool.connect()` **inside** the `try`; `close()` → `pool.close()` best-effort. In `describeSqlServer`, run the six queries sequentially inside `withCatalogSession`.
- **SQLite** (`packages/sqlite/src/exec/sqlite.ts`): one `new Database(filename, { readonly: true, fileMustExist: true, timeout })` per session (`timeout` here is better-sqlite3's busy/lock-wait timeout — say so in a comment); `db.exec("BEGIN")` right after open; `close()` → `db.exec("COMMIT")` best-effort, then `db.close()`. In `describeSqlite`, run the five queries sequentially inside `withCatalogSession`.

Update each engine's `*.lazy.test.ts` fake driver only as far as the new calls require (e.g. a `parseConnectionString` static and `exec` method), keeping those tests' assertions unchanged.

**Verify**: `pnpm build && pnpm --filter @askdb/mysql --filter @askdb/sqlserver --filter @askdb/sqlite test` → all pass.

### Step 4: Tests (apply the test-audit authoring gate)

See Test plan. **Verify**: `pnpm test` → exit 0; the new test files report their cases as passing.

### Step 5: Docs and changeset

- `docs/integration/connectors.md` "Live execution" section: document `openSession` / `CatalogSession`, `withCatalogSession`, `defineSessionCatalogRunner`, the per-engine snapshot table from "Current state", and the default 60 s statement timeout. Keep the existing rules list.
- `docs/specs/introspection.md`: in "In scope", fix the stale name `createPostgresCatalogRunner` → `createPostgresCatalogQueryRunner` and add one sentence on session semantics.
- `apps/docs-site`: `grep -rn "catalog query runner" apps/docs-site/src/content/docs` — the `reference/packages.mdx` blurbs only name the runner; change them only if you find a claim your change makes false. Do not invent new pages.
- `.changeset/catalog-session-runner.md`: `@askdb/introspect` minor (new public API), `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlserver`, `@askdb/sqlite` minor (new factory option + behavior). Body: one connection per introspection, Postgres snapshot, default timeout and how to disable it.

**Verify**: `pnpm docs:build && pnpm changeset status` → exit 0, and the status lists only the five packages above plus their internal dependents at patch — no package jumps to a new major line. Then `pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

Owner boundaries and the regression each test catches:
1. `packages/introspect/src/kit/session.test.ts` (owner: the session helper). Cases: runner without `openSession` is called directly; with `openSession`, exactly one open and one close for N queries; `close` still runs once when `fn` throws, and the rejection is `fn`'s error even if `close` rejects; `defineSessionCatalogRunner` one-off call opens and closes one session. Catches: leaked sessions, masked errors.
2. `packages/postgres/src/exec/postgres.session.test.ts` (owner: the Postgres runner at the `pg` driver boundary; mock `pg` with `vi.mock` recording calls, following `postgres.lazy.test.ts`). Cases: statement sequence is `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, `SET LOCAL statement_timeout = 60000`, queries…, `COMMIT`, and `end` once; `statementTimeoutMs: 0` omits `SET LOCAL`; a rejected `connect()` still calls `end` and rejects with `PostgreSQL catalog query failed:`; a failing query triggers `ROLLBACK` and `end`; a full `describePostgres({ runner: createPostgresCatalogQueryRunner(url) })` constructs exactly **one** `Client`. This closes the "nothing asserts BEGIN READ ONLY" gap and catches a regression to per-query connections.
3. One mocked-driver test each for MySQL and SQL Server (same style): a full `describe*()` opens exactly one connection/pool; a failed connect still closes. Catches: the `Promise.all` fan-out coming back; the SQL Server connect-outside-`try` leak.
4. Live, `packages/sqlite/src/exec/sqlite.integration.test.ts` (real better-sqlite3, no server): put the file in WAL mode, open `runner.openSession!()`, count tables, create a table from a second write handle, count again in the session → unchanged; after `close()`, a new session sees it. Catches: session not actually holding a read transaction.
5. Live, `packages/postgres/src/exec/postgres.integration.test.ts` (`DATABASE_URL`): (a) same snapshot check with a random temp schema (drop it in `afterAll`); (b) `createPostgresCatalogQueryRunner(url, { statementTimeoutMs: 200 })("SELECT pg_sleep(2)")` rejects with a message matching `/statement timeout/`. Catches: timeout or isolation level silently not applied.

Existing suites that must stay green unchanged: Pagila (`pagila.integration.test.ts`), `partition-fk.integration.test.ts`, MySQL/SQL Server integration, and every `describe.test.ts`.

## Done criteria

- [ ] Readiness check passed and is quoted in the PR description.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight` exit 0.
- [ ] `git grep -n "new pgRuntime.Pool" packages/postgres/src` → no matches; `git grep -n "Promise.all" packages/{mysql,sqlserver,sqlite}/src/connector/describe.ts` → no matches.
- [ ] `git grep -n "REPEATABLE READ READ ONLY" packages/postgres/src/exec/postgres.ts` → one match.
- [ ] New tests from the Test plan exist and pass; CI's integration job is green with `ASKDB_REQUIRE_INTEGRATION=1`.
- [ ] `git diff --stat` touches no `fold*Result` function and no template SQL.
- [ ] `.changeset/catalog-session-runner.md` exists; `pnpm changeset status` shows no unexpected major.

## STOP conditions

- Readiness check fails.
- Pagila or any existing live suite fails only after this change and the cause is the timeout (a catalog query legitimately exceeding 60 s) — report timings; do not raise the default silently.
- A mocked-driver test would need a production-only seam (an exported internal, a test flag) to count connections. Move the assertion to the driver boundary via `vi.mock`, or report.
- `ConnectionPool.parseConnectionString` does not exist on the installed `mssql` (check `node -e "console.log(typeof require('mssql').ConnectionPool.parseConnectionString)"` from `packages/sqlserver`) — report instead of hand-parsing ADO.NET strings.
- Making queries sequential measurably slows a live suite by more than 2× — report numbers.

## Maintenance notes

- A future config key (`introspection.statementTimeoutMs`) should flow into the four factory calls in each engine's `provider.ts` (`createRunner: (url) => createXCatalogQueryRunner(url)`), not into the describe functions.
- BYO runners (Neon HTTP, `postgres.js`, test fakes) keep per-call semantics unless they add `openSession`. Document that contract, not engine internals.
- Reviewer focus: every failure path releases the connection exactly once; `close()` can never replace the original error; the Postgres snapshot caveat for helper functions is written down in the code.
- Deferred: sharing one "safe connection" helper between Studio execute and catalog sessions; MySQL `START TRANSACTION READ ONLY` (adds nothing for `information_schema`).
