# Contributing

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

AskDB is a pnpm/Turborepo TypeScript monorepo. Keep changes scoped to the package or app you are touching, and add tests for behavior that affects public APIs, package output, SQL safety, or user-facing workflows.

## Local Setup

```bash
pnpm install
pnpm build
pnpm test
```

If `pnpm build` fails with **Cannot find module `.../node_modules/turbo/bin/turbo`**, your `node_modules` tree is out of sync (common after interrupted installs or worktree sync). Run **`rm -rf node_modules && pnpm install`**, then try again. The **`publicHoistPattern`** in `pnpm-workspace.yaml` hoists `turbo` to reduce broken bin shims; root scripts use **`pnpm exec turbo`** so the CLI is resolved through pnpm.

Use Node 22.13 or newer (pnpm 11's own floor) and pnpm 11. The published libraries support Node `>=22.12`; CI builds and runs the unit suites on Node 22.12.0 and 24. Optional Postgres fixtures live under `fixtures/` for integration checks.

`pnpm test` runs each package's `test` task through Turbo, which first builds that package and its workspace dependencies (`test` depends on `build` and `^build`). Tests that spawn `apps/cli/dist/cli.js` rely on that; if you run `vitest` directly inside a package, run `pnpm build` first.

## Integration Tests

The `*.integration.test.ts` suites run against live databases and **skip** when their connection URL is not set, so a plain `pnpm test` stays green without Docker. Start the fixtures you need and export the matching variables:

| Variable | Suite | Fixture (from repo root) |
| --- | --- | --- |
| `DATABASE_URL` | `@askdb/postgres` query runner | any Postgres, e.g. the pgvector fixture below: `postgres://postgres:postgres@127.0.0.1:5434/askdb_rag` |
| `PAGILA_DATABASE_URL` | `@askdb/postgres` live introspection against Pagila | `pnpm pagila:up` → `postgres://postgres:postgres@127.0.0.1:5433/pagila` |
| `MYSQL_DATABASE_URL` | `@askdb/mysql` | `docker compose -f fixtures/mysql/docker-compose.yml up -d --wait` → `mysql://root:mysql@127.0.0.1:3306/askdb_test` |
| `MSSQL_DATABASE_URL` | `@askdb/sqlserver` | `docker compose -f fixtures/sqlserver/docker-compose.yml up -d --wait`, then create `askdb_test` (see the compose file) → `Server=127.0.0.1,1433;Database=askdb_test;User Id=sa;Password=AskDB.123;Encrypt=false` |
| `ASKDB_PGVECTOR_URL` (or `PGVECTOR_URL`) | `@askdb/rag` pgvector store | `pnpm pgvector:up` → `postgres://postgres:postgres@127.0.0.1:5434/askdb_rag` |

The SQLite suite needs no server; it only needs the optional `better-sqlite3` native driver, which `pnpm install` builds.

Set `ASKDB_REQUIRE_INTEGRATION=1` to make a missing prerequisite (an unset URL, or a `better-sqlite3` that fails to load) **fail** the suite instead of skipping it. CI sets it so a misconfigured job can't pass by running no integration tests.

Turbo runs tasks in strict env mode: only variables listed in the `test` task's `env` in [`turbo.json`](turbo.json) reach vitest. If you add an integration suite gated on a new variable, add the variable there and gate the suite with `integrationSuite()` from [`scripts/test-utils/integration.mjs`](scripts/test-utils/integration.mjs).

### Repo-root `askdb.config.ts` and your IDE

The workspace root lists `@askdb/config` as a dev dependency so Node can resolve the package. For the editor, **root `tsconfig.json`** (only top-level `*.ts`) adds `compilerOptions.paths` so `@askdb/config` maps to **`packages/config/src`** (Cmd+click and type errors use source, not only `dist`). Shared compiler defaults live in **`tsconfig.base.json`**; packages extend that file so they do not inherit the root-only `paths` mapping. After dependency changes, run `pnpm install`, then **TypeScript: Restart TS Server** in the IDE if needed.

## Dependency Audit

CI's `audit` job (and `pnpm preflight`) runs `pnpm run audit` — [`audit-ci`](https://github.com/IBM/audit-ci) over `pnpm audit`, failing on any advisory of **moderate** severity or higher, in any dependency (dev-only ones included). Configuration lives in [`.audit-ci.json`](.audit-ci.json).

When it fails, prefer fixing over allowlisting:

1. If the patched version is inside the existing semver range, refresh the lockfile without touching `package.json`: `pnpm update -r --no-save <pkg>...` (this also moves transitive dependencies).
2. If an intermediate package pins a vulnerable range, bump that parent, or add a documented `overrides` entry in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) (see the existing ones for the expected rationale).
3. Allowlist only an advisory that is clearly not exploitable in how AskDB uses the package. JSON has no comments, so every `allowlist` entry must have a row in the table below, and should be scoped to its path (`GHSA-xxxx|path>to>pkg`) where possible. `show-not-found` is on, so stale entries are reported — delete them once the advisory no longer matches.

| Advisory | Package / path | Why it is not exploitable here | Remove when |
| --- | --- | --- | --- |
| _none_ | | | |

## Before Opening a PR

Run the release-style checks when a change affects published packages, CLIs, docs, workflows, or package metadata:

```bash
pnpm smoke:install
pnpm preflight
```

Add a changeset for publishable package changes:

```bash
pnpm changeset
```

AskDB is currently pre-1.0. Breaking public API changes should normally use a minor changeset unless the project intentionally moves a package to 1.0.

## Safety Boundary

AskDB public surfaces return generated SQL for review. They do not execute generated SQL. Any downstream execution must happen under the integrator's own database roles, read-only controls, tenant policy, approval process, and audit logging.

Never commit real `.env` files, API keys, database credentials, customer schemas, or production query outputs.
