# Plan 029: Remove the CLI's bundled Postgres driver and make optional database drivers resolve consistently

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`, unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f4a508e..HEAD -- apps/cli/package.json packages/postgres packages/mysql packages/sqlite packages/sqlserver examples/installable-smoke docs apps/docs-site .changeset`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt | bug | docs
- **Planned at**: commit `f4a508e`, 2026-06-25

## Why this matters

AskDB's documented architecture says database drivers are optional peers owned by engine integration packages, but the CLI currently bundles `pg` directly. That masks Postgres missing-peer behavior, makes SQL Server/MySQL/SQLite behave differently under `npx`/`dlx`, and weakens the package boundary between the first-party CLI host and connector packages. After this plan, the CLI no longer depends on `pg`; all four live introspection drivers (`pg`, `mysql2`, `better-sqlite3`, `mssql`) are resolved by their adapter packages, including from the user's project when the CLI is launched through an ephemeral runner.

## Current state

- `docs/specs/distribution.md` documents the desired boundary:

  ```md
  docs/specs/distribution.md:31 - `@askdb/core` is dialect-agnostic and imports no database driver.
  docs/specs/distribution.md:32 - each integration package declares its driver as a peer; lazy-import path throws a clear error when absent.
  docs/specs/distribution.md:34 - apps/cli is a first-party reference app; packages/ contains the library surface.
  ```

- `apps/cli/package.json` violates that boundary by depending on `pg` directly:

  ```json
  apps/cli/package.json:46 "dependencies": {
  apps/cli/package.json:57   "@askdb/mysql": "workspace:*",
  apps/cli/package.json:58   "@askdb/postgres": "workspace:*",
  apps/cli/package.json:60   "@askdb/sqlite": "workspace:*",
  apps/cli/package.json:61   "@askdb/sqlserver": "workspace:*",
  apps/cli/package.json:66   "pg": "^8.21.0"
  apps/cli/package.json:67 }
  ```

- `@askdb/postgres` already declares `pg` as an optional peer, but the CLI dependency masks that contract:

  ```json
  packages/postgres/package.json:55 "peerDependencies": {
  packages/postgres/package.json:56   "pg": ">=8"
  packages/postgres/package.json:58 "peerDependenciesMeta": {
  packages/postgres/package.json:59   "pg": { "optional": true }
  packages/postgres/package.json:63 "devDependencies": {
  packages/postgres/package.json:65   "pg": "^8.21.0"
  ```

- The SQL Server adapter currently only tries a bare dynamic import from inside the adapter package:

  ```ts
  packages/sqlserver/src/exec/sqlserver.ts:17 async function loadMssqlOrThrow(): Promise<MssqlModule> {
  packages/sqlserver/src/exec/sqlserver.ts:19   mssqlModulePromise = import("mssql").catch((cause) => {
  packages/sqlserver/src/exec/sqlserver.ts:22     "The built-in SQL Server catalog query runner requires the optional `mssql` peer dependency. " +
  packages/sqlserver/src/exec/sqlserver.ts:23       "Install it (e.g. `pnpm add mssql`) or pass a custom catalog query runner..."
  ```

- MySQL and SQLite use the same bare-import pattern:

  ```ts
  packages/mysql/src/exec/mysql.ts:13 async function loadMysql2OrThrow(): Promise<typeof import("mysql2/promise")> {
  packages/mysql/src/exec/mysql.ts:15   mysql2ModulePromise = import("mysql2/promise").catch((cause) => {

  packages/sqlite/src/exec/sqlite.ts:19 async function loadBetterSqlite3OrThrow(): Promise<Bs3Namespace> {
  packages/sqlite/src/exec/sqlite.ts:21   bs3ModulePromise = (import("better-sqlite3") as unknown as Promise<Bs3Namespace>).catch((cause) => {
  ```

- The CLI imports connector providers from all engine packages in `apps/cli/src/introspect.ts:24-28`; `askdb introspect` calls those providers through a registry. Keep that registry shape.

- The installable smoke test currently installs the packaged CLI and adapters but does not prove the `npx`/project-driver resolution case:

  ```sh
  examples/installable-smoke/run.sh:309      askdb: 'file:$CLI_TARBALL',
  examples/installable-smoke/run.sh:313      '@askdb/mysql': 'file:$MYSQL_TARBALL',
  examples/installable-smoke/run.sh:314      '@askdb/sqlite': 'file:$SQLITE_TARBALL',
  examples/installable-smoke/run.sh:315      '@askdb/sqlserver': 'file:$SQLSERVER_TARBALL'
  examples/installable-smoke/run.sh:360 (cd "$WORK/apps" && ./node_modules/.bin/askdb --help | grep -q 'AskDB')
  examples/installable-smoke/run.sh:361 (cd "$WORK/apps" && ./node_modules/.bin/askdb introspect templates --engine postgres | grep -q '^-- schemas')
  ```

- Docs currently mention drivers but do not explain that live introspection requires the driver to be available to the running CLI process:

  ```mdx
  apps/docs-site/src/content/docs/guides/switch-engines.mdx:29 | Engine | Adapter package | `dialect` value | Suggested driver |
  apps/docs-site/src/content/docs/guides/switch-engines.mdx:31 | PostgreSQL | `@askdb/postgres` | `"postgres"` | `pg` |
  apps/docs-site/src/content/docs/guides/switch-engines.mdx:34 | SQL Server | `@askdb/sqlserver` | `"sqlserver"` | `mssql` |
  apps/docs-site/src/content/docs/reference/cli.mdx:10 ## Install
  apps/docs-site/src/content/docs/reference/cli.mdx:12 npm install askdb
  ```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build changed packages | `pnpm -C packages/connectors build && pnpm -C packages/postgres build && pnpm -C packages/mysql build && pnpm -C packages/sqlite build && pnpm -C packages/sqlserver build && pnpm -C apps/cli build` | exit 0 |
| Targeted tests | `pnpm --filter @askdb/postgres test -- src/exec/postgres.lazy.test.ts` | exit 0; lazy-peer tests pass |
| CLI tests | `pnpm --filter askdb test -- src/introspect-shim.test.ts` | exit 0 |
| Install smoke | `pnpm smoke:install` | exit 0; smoke reports `PASSED` |
| Docs build | `pnpm docs:build` | exit 0 |
| Full verification | `pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope**:

- `apps/cli/package.json`
- `pnpm-lock.yaml`
- `packages/postgres/src/exec/postgres.ts`
- `packages/mysql/src/exec/mysql.ts`
- `packages/sqlite/src/exec/sqlite.ts`
- `packages/sqlserver/src/exec/sqlserver.ts`
- Tests under `packages/{postgres,mysql,sqlite,sqlserver}/src/exec/`
- `examples/installable-smoke/run.sh`
- `packages/{postgres,mysql,sqlite,sqlserver}/README.md`
- `apps/cli/README.md`
- `README.md`
- `docs/specs/distribution.md`
- `docs/specs/introspection.md`
- Relevant docs-site pages under `apps/docs-site/src/content/docs/`, especially `guides/switch-engines.mdx`, `reference/cli.mdx`, and `reference/packages.mdx`
- One changeset under `.changeset/`

**Out of scope**:

- Do not change the connector registry API in `@askdb/connectors`.
- Do not make the CLI dynamically install drivers.
- Do not move SQL catalog query logic out of the engine packages.
- Do not change `@askdb/core` dialect generation or validation behavior.
- Do not add live database integration tests that require local Postgres/MySQL/SQLite/SQL Server unless the repo already gates them by environment variable.

## Git workflow

- Branch: keep the current branch name unless the operator tells you otherwise.
- Commit style in recent history uses conventional prefixes such as `fix(docs-site): ...`, `feat(examples): ...`, and `chore: ...`. Use one logical commit for the implementation and docs, or split into `fix(cli): ...` and `docs: ...` if the operator asks for atomic commits.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Remove the CLI's direct Postgres driver dependency

Delete `"pg": "^8.21.0"` from `apps/cli/package.json`. Run the package manager to refresh `pnpm-lock.yaml`; use the repo's package manager (`pnpm`) and avoid hand-editing lockfile internals. `pg` must remain a dev dependency and optional peer of `@askdb/postgres`.

Do not remove `@askdb/postgres` from the CLI. The CLI still needs the Postgres connector provider for `askdb introspect`.

**Verify**: `node -e "const p=require('./apps/cli/package.json'); if (p.dependencies.pg) throw new Error('askdb still depends on pg')"` -> exit 0.

### Step 2: Add a project-aware optional peer resolver

Implement a small helper that each live-driver adapter can use to load optional peers in this order:

1. Try the current bare dynamic import from the adapter package, preserving today's behavior for normal installed packages and tests.
2. If that fails with a module-resolution failure, try resolving from the current working directory with `createRequire(join(process.cwd(), "package.json"))`.
3. Import the resolved file URL with `import(pathToFileURL(resolved).href)` so ESM can load the CommonJS driver.
4. If both attempts fail, throw the existing `AskDbError`, but update the message to mention both local project installs (`pnpm add <driver>`) and ephemeral runners (`pnpm dlx -p askdb -p <driver> askdb ...` or `npx -p askdb -p <driver> askdb ...`).

Preferred placement: keep the helper private to the adapter packages unless duplication becomes painful. If you centralize it, `@askdb/connectors` is the least-bad shared home because all four adapter packages already depend on it; do not put Node module-resolution policy into `@askdb/core`.

Important implementation details:

- Preserve the existing promise cache and reset functions (`__resetPgModuleCacheForTests`, `__resetMysql2ModuleCacheForTests`, `__resetBetterSqlite3ModuleCacheForTests`, `__resetMssqlModuleCacheForTests`).
- Clear the cache on failure so a long-running process can retry after the user installs the driver.
- Preserve runtime CJS interop handling:
  - `pg`: use `.default ?? mod`, then `new pgRuntime.Pool(...)`.
  - `mysql2/promise`: use `.default ?? mod`, then `mysql.createConnection(...)`.
  - `better-sqlite3`: its constructor is under `.default`.
  - `mssql`: use `.default ?? mod`, then `new mssql.ConnectionPool(...)`.
- Avoid swallowing non-resolution errors from the driver package itself. If a driver is found but throws while evaluating, surface that as the cause of the `AskDbError` rather than pretending the package is missing.

**Verify**: `pnpm -C packages/postgres build && pnpm -C packages/mysql build && pnpm -C packages/sqlite build && pnpm -C packages/sqlserver build` -> exit 0.

### Step 3: Add regression tests for all four optional driver loaders

Add or extend tests under each adapter's `src/exec/` directory.

Required cases:

- Constructing `create*CatalogQueryRunner(...)` does not load the driver.
- Missing driver rejects with an `AskDbError` that names the correct optional peer.
- A previous missing-driver failure clears the cache and retries on the next call.
- The loader can resolve the driver from a controlled project `cwd` even when the adapter's own bare import path cannot see it.

Use existing `packages/postgres/src/exec/postgres.lazy.test.ts` as the structural pattern, but adjust it because the new `createRequire(process.cwd())` fallback can make monorepo dev dependencies visible and hide missing-peer behavior. For the project-`cwd` case, prefer a subprocess or temporary fixture with a controlled `node_modules` graph over a pure Vitest mock. If a test cannot be made deterministic without real driver installation cost, put that coverage in the installable smoke script instead and keep the unit tests focused on cache/error behavior.

**Verify**: run each targeted exec test:

```sh
pnpm --filter @askdb/postgres test -- src/exec/postgres.lazy.test.ts
pnpm --filter @askdb/mysql test -- src/exec/mysql*.test.ts
pnpm --filter @askdb/sqlite test -- src/exec/sqlite*.test.ts
pnpm --filter @askdb/sqlserver test -- src/exec/sqlserver*.test.ts
```

Expected: exit 0. If existing `*.integration.test.ts` files require database env vars and are skipped without env, that is acceptable; do not make them require live services.

### Step 4: Strengthen the installable smoke test around packaged CLI driver boundaries

Update `examples/installable-smoke/run.sh` so the packaged CLI app sandbox proves two things:

- `askdb` tarball installation does not install `pg` transitively through the CLI.
- Live introspection driver dependencies are satisfied by the app sandbox when installed there, not by the CLI manifest.

Suggested smoke shape:

1. After app sandbox install, assert `node -e "require.resolve('askdb/package.json'); require.resolve('@askdb/postgres/package.json')"` works.
2. Assert `node -e "require.resolve('pg')"` fails before adding `pg` to the app sandbox, proving the CLI no longer bundles it.
3. Install `pg` in the app sandbox, then run a command that invokes the Postgres catalog runner far enough to prove `pg` resolved. It can fail on connection refused against a dummy URL; assert the error is a PostgreSQL connection/catalog error, not the optional-peer missing error.
4. Add the analogous SQL Server check if runtime/install cost is acceptable: install `mssql`, run `askdb introspect --engine sqlserver --url <dummy> --print`, and assert the failure is not the optional-peer missing error. If `mssql` install cost makes smoke too slow, keep SQL Server covered by unit/subprocess tests and document that choice in a comment.

Do not require a live database for these smoke checks.

**Verify**: `pnpm smoke:install` -> exit 0 and `smoke: PASSED`.

### Step 5: Update package and CLI docs

Update package READMEs and the CLI README so the driver story is consistent:

- `packages/postgres/README.md`: keep `pg` as an optional peer, but do not imply the CLI bundles it. If showing live introspection, include `pnpm add pg`.
- `packages/mysql/README.md`, `packages/sqlite/README.md`, `packages/sqlserver/README.md`: ensure they mention the live introspection driver install and the correct ephemeral-runner form.
- `apps/cli/README.md`: add a short "Live introspection drivers" note. Say `askdb init` installs config support, not database drivers. For `npx`/`pnpm dlx`, show how to include the driver in the same ephemeral command, for example:

  ```sh
  pnpm dlx -p askdb -p mssql askdb introspect --engine sqlserver --url "$SQLSERVER_URL"
  npx -p askdb -p mssql askdb introspect --engine sqlserver --url "$SQLSERVER_URL"
  ```

  Also show the preferred project-local path:

  ```sh
  pnpm add -D askdb
  pnpm add mssql
  pnpm exec askdb introspect
  ```

Use exact package names: `@askdb/sqlserver` and `mssql`; do not write `@askbd/sqlserver`.

**Verify**: `grep -RIn "@askbd/sqlserver" README.md docs apps/docs-site packages apps/cli || true` -> no output.

### Step 6: Update internal docs and docs-site pages

Update internal docs:

- `docs/specs/distribution.md`: change the design-decision text from an idealized boundary to the actual contract after this change. Mention that CLI hosts connector providers but does not bundle database drivers; live connector runners resolve optional peers from the running package graph and, for ephemeral CLIs, from the caller's project.
- `docs/specs/introspection.md`: update scope/test bar if it claims air-gapped parity for MySQL/SQLite/SQL Server where not implemented. Keep this plan focused on driver resolution, but do not leave false live-driver docs in touched sections.

Update docs-site:

- `apps/docs-site/src/content/docs/guides/switch-engines.mdx`: Step 1 should install both adapter and live introspection driver when the user plans to introspect. Step 2 should avoid suggesting bare `npx askdb introspect` for non-Postgres engines unless the driver is available to that execution environment. Use `pnpm exec askdb` after project install or `pnpm dlx -p askdb -p <driver> askdb ...` for one-off runs.
- `apps/docs-site/src/content/docs/reference/cli.mdx`: add a note in the `askdb introspect` section that live introspection requires the engine driver (`pg`, `mysql2`, `better-sqlite3`, `mssql`) in the project or the same `npx`/`dlx` command.
- `apps/docs-site/src/content/docs/reference/packages.mdx`: align the package reference so all engine packages list their optional live introspection driver consistently. Postgres should not be special.

Avoid internal env-projection names unless a page already owns that low-level reference. Use config fields and package-manager commands in user-facing docs.

**Verify**: `pnpm docs:build` -> exit 0.

### Step 7: Add a changeset

Add a changeset under `.changeset/` covering:

- `askdb`: patch, because the CLI dependency graph changes and live introspection driver behavior changes for package consumers.
- `@askdb/postgres`, `@askdb/mysql`, `@askdb/sqlite`, `@askdb/sqlserver`: patch, because optional peer resolution/error messaging changes.

Suggested summary:

```md
Remove the CLI's direct `pg` dependency and make live introspection drivers resolve consistently as optional peers from the running project. This fixes `npx`/`dlx` SQL Server, MySQL, SQLite, and Postgres driver resolution when the driver is installed with the application or supplied in the same ephemeral command.
```

**Verify**: `test -n "$(ls .changeset/*.md | grep -v README.md | tail -n 1)"` -> exit 0.

## Test plan

- Unit tests for each adapter's lazy optional-peer loader.
- Packaged CLI install smoke proving `askdb` no longer installs `pg` and that installed project drivers satisfy live introspection runner loading.
- Docs-site build after all MDX updates.
- Full repo lint and tests before handoff.

## Done criteria

- [ ] `apps/cli/package.json` has no direct `pg` dependency.
- [ ] `@askdb/postgres` still has `pg` as an optional peer and dev dependency.
- [ ] All four live driver loaders can resolve their optional peer from the adapter package path and from the caller/project `cwd`.
- [ ] Missing-peer errors mention both project-local install and one-off `npx`/`pnpm dlx` usage.
- [ ] `pnpm smoke:install` proves the packaged CLI does not install `pg` by itself.
- [ ] Package READMEs, internal docs, and docs-site pages describe the optional-driver boundary consistently.
- [ ] A changeset exists for `askdb` and the four engine adapter packages.
- [ ] `pnpm docs:build`, targeted adapter tests, `pnpm lint`, and `pnpm test` all exit 0.

## STOP conditions

Stop and report back if:

- Any current-state excerpt in this plan no longer matches the live code.
- Removing `pg` from the CLI causes `askdb ask` or non-live-introspection commands to require a database driver.
- The project-`cwd` fallback requires importing from global npm cache internals or hard-coding package-manager-specific paths.
- The fix appears to require changing the public `ConnectorProviderAdapter` or `ConnectorRegistry` API.
- The installable smoke check becomes dependent on a live database service.
- `pnpm smoke:install` becomes materially slower due to installing `mssql` and there is no acceptable narrower subprocess/unit test replacement.

## Maintenance notes

- Reviewers should scrutinize module-resolution behavior. The goal is not "find packages anywhere"; it is "normal package resolution first, then the caller's project when an ephemeral CLI is running from outside that project."
- Keep `@askdb/core` free of database-driver and Node module-resolution policy. This remains an adapter/connector host concern.
- Future live connector packages should copy this optional-peer loader pattern or use the shared helper if one was introduced in this plan.
- If the docs later recommend `npx askdb@latest introspect` again, make sure the same snippet includes the required driver package for live introspection.
