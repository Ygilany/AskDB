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

Use Node 22.14 or newer and pnpm 11. The published libraries support Node `>=22.14`; CI builds and runs the unit suites on Node 22.14.0 and 24. Optional Postgres fixtures live under `fixtures/` for integration checks.

`pnpm test` runs each package's `test` task through Turbo, which first builds that package and its workspace dependencies (`test` depends on `build` and `^build`). Tests that spawn `apps/cli/dist/cli.js` rely on that; if you run `vitest` directly inside a package, run `pnpm build` first.

## Integration Tests

The `*.integration.test.ts` suites run against live databases and **skip** when their connection URL is not set, so a plain `pnpm test` stays green without Docker. Start the fixtures you need and export the matching variables:

| Variable | Suite | Fixture (from repo root) |
| --- | --- | --- |
| `DATABASE_URL` | `@askdb/postgres` query runner | any Postgres, e.g. the pgvector fixture below: `postgres://postgres:postgres@127.0.0.1:5434/askdb_rag` |
| `ASKDB_FIXTURE_HOST` | Live introspection in `@askdb/postgres`, `@askdb/mysql` (MySQL and MariaDB), `@askdb/sqlserver`, `@askdb/sqlite` and the `askdb` CLI, checked against one golden schema; the fixture's own dataset check | `pnpm fixture:up` → `127.0.0.1` (see [Multi-engine fixture](#multi-engine-fixture)) |
| `MYSQL_DATABASE_URL` | `@askdb/mysql` | `docker compose -f fixtures/mysql/docker-compose.yml up -d --wait` → `mysql://root:mysql@127.0.0.1:3306/askdb_test` |
| `MSSQL_DATABASE_URL` | `@askdb/sqlserver` | `docker compose -f fixtures/sqlserver/docker-compose.yml up -d --wait`, then create `askdb_test` (see the compose file) → `Server=127.0.0.1,1433;Database=askdb_test;User Id=sa;Password=AskDB.123;Encrypt=false` |
| `ASKDB_PGVECTOR_URL` (or `PGVECTOR_URL`) | `@askdb/rag` pgvector store; Studio's RAG index on pgvector | `pnpm pgvector:up` → `postgres://postgres:postgres@127.0.0.1:5434/askdb_rag`; `pnpm pgvector:test` runs both suites |

The SQLite suite needs no server; it only needs the optional `better-sqlite3` native driver, which `pnpm install` builds.

Set `ASKDB_REQUIRE_INTEGRATION=1` to make a missing prerequisite (an unset URL, or a `better-sqlite3` that fails to load) **fail** the suite instead of skipping it. CI sets it so a misconfigured job can't pass by running no integration tests.

Turbo runs tasks in strict env mode: only variables listed in the `test` task's `env` in [`turbo.json`](turbo.json) reach vitest. If you add an integration suite gated on a new variable, add the variable there and gate the suite with `integrationSuite()` from [`scripts/test-utils/integration.mjs`](scripts/test-utils/integration.mjs).

`pnpm lint` runs [`scripts/check-test-gating.mjs`](scripts/check-test-gating.mjs), which fails on these hand-rolled gates in the tests of every workspace package except the consumer lab (see [Consumer lab](#consumer-lab)):

- `describe.skip` or `describe.todo`, or `.skipIf` or `.runIf` on a suite or test.
- `it.skip` passed around as a value, or `cond ? describe : …`.
- Options that skip or invert: a `{ skip: cond }`, `{ todo: cond }` or `{ fails: cond }` options argument, or a suite's `{ skip: true }`, `{ todo: true }` or `{ fails: true }`.
- Any argument after the name picked by a condition (a body picked by `url ? fn : undefined` becomes a todo), unless every value it can pick is plainly not a function: a literal, `undefined`, a `process.env` read, arithmetic or a template over such values, a number conversion such as `Number(…)`, `parseInt(…)` or `Math.max(…)` over them, or a `const` bound to one (`url ? 10_000 : 5_000`).
- A body built by a call over any pick (`withDb(url ?? ":memory:", fn)`), since the call may read the pick any way.
- A suite or test defined only under a condition: `if`/`else`, a `switch` case, `try`/`catch`, `?:`, `&&`, `||`, `??`, `&&=`, `||=`, `??=`, the arguments or key of an optional chain (`a?.b(…)`, `a?.[…]`), a default value, or a callback passed to a call other than a `forEach`/`map`/`flatMap` method that takes it first (such as `_.forEach(rows, cb)` or `.then`).
- A `.each` table or loop whose rows a condition can add or drop (`[url ? "pg" : null, "sqlite"].filter(Boolean)`, `[process.env.PG_URL, process.env.MYSQL_URL].filter(Boolean)`, `[url, mysqlUrl].filter(Boolean)` over `const`s holding env reads), inline or in a `const`, or resized under a condition (`if (url) rows.push(url)`, `map.set(…)`, `rows[1] = …`, `tables.pg = …`, `delete tables.pg`, `rows.length--`, a `let` reassigned), or a `for` or `while` loop whose condition holds such a pick. ADR 0019 ("What counts as a gate") lists the table forms the check reads.
- Any use it can't read, which fails as an unreadable use:
  - a reference held in an object, an array or a destructuring, or `describe.call(…)`;
  - `vi.importActual` or `vi.importMock` taken off `vi` before the call (`const ia = vi.importActual`, `const { importActual } = vi`), or `vi` itself (or `vitest`, the same object) used other than through a member written out (`Reflect.get(vi, …)`, `vi[k]`);
  - a suite's result kept or read (`describe(…).test`);
  - options or a timeout built by a call in an argument that isn't the body (`Object.assign(…)`, `optionsFor(env)`);
  - a suite body other than an inline function or a `const` function with no parameter: a named body that takes a parameter (`describe(name, body)` with `function body(test)`), a `let`, `function` or global body, a body passed third after a value that isn't options, a body read off an object (`suites.db`) or returned by a call (`makeBody()`), or a `function` body reading `arguments`.

A suite body's parameter (`describe(name, (test) => …)`) is Vitest's test API and is checked like `test`.

A directly called `it.skip(…)` or `it.todo(…)`, or a test's literal `{ skip: true }`, `{ todo: true }` or `{ fails: true }`, stays allowed. The check parses each file with the TypeScript compiler ([ADR 0019](docs/adrs/0019-test-gating-check-parses-with-typescript.md)) and fails on a test file it cannot parse. Its own tests run under `node --test` (`pnpm lint` runs them first), not Vitest, because `scripts/` isn't a workspace package. A line that genuinely needs a gate takes `// check-test-gating-ignore-next-line: <reason>` on the line above, and the reason is required. The check can't see every gate: options or a body passed in a variable, `ctx.skip()` in a test body, a `while` or `for` whose condition reads a value without a pick (`while (url)`), a gate inside a helper called under a condition, a test API imported from another module, or a value returned by an inline function, among others, pass it ([ADR 0019](docs/adrs/0019-test-gating-check-parses-with-typescript.md) lists them all), so review new suites for these.

### Multi-engine fixture

[`fixtures/multi-engine`](fixtures/multi-engine/README.md) holds one logical schema and one dataset in PostgreSQL 17, MySQL 8.4, MariaDB 11.4, SQL Server 2022 and SQLite, with a golden logical schema (`dataset/schema.logical.json`) every engine's introspection is compared against. It covers multiple schemas, composite keys and foreign keys, a view, a reserved-word table, a declaratively partitioned Postgres table (ADR 0003), a self-referencing tenant hierarchy, sensitive columns, unicode, dates, decimals and booleans. It replaces the Pagila fixture.

```bash
pnpm fixture:up                                   # start, wait for health, seed (idempotent)
export ASKDB_FIXTURE_HOST=127.0.0.1               # enables the suites that use it
pnpm --filter @askdb/postgres test                # e.g. live introspection vs. the golden schema
pnpm fixture:down                                 # stop (data kept); pnpm fixture:reset starts over
```

It uses ports 15432, 13306, 13307 and 11433, so it runs alongside the fixtures above. A new engine-level test that needs a real schema should use it: import the helpers from `fixtures/multi-engine/src/index.ts` by relative path and gate the suite with `integrationSuite({ env: ["ASKDB_FIXTURE_HOST"] })`.

### Consumer lab

[`examples/consumer-lab`](examples/consumer-lab/README.md) tests AskDB as a black box. It installs AskDB into an app outside the workspace (its own pnpm root and lockfile), from packed tarballs or from npm, then executes the SQL AskDB returns on the fixture above. Design: [`docs/specs/consumer-lab.md`](docs/specs/consumer-lab.md); remaining work: #241. Agents drive it with the [`consumer-lab` skill](.agents/skills/consumer-lab/SKILL.md): which target to install, how to read the matrix, and how to refresh the baseline after a release.

```bash
pnpm lab:up                                       # fixture up + install the lab (first time)
pnpm lab:use .                                    # repack this checkout and reinstall
pnpm lab:use git:origin/main                      # …or pack a branch, tag or commit
pnpm lab:use npm:askdb@1.0.0-beta.40              # …or a published release (or npm:<dist-tag>)
pnpm lab ask --db mysql "For each agency, show its id and how many active programs it runs."   # replay model, no API key
pnpm lab ask --db sqlite --via client "…"          # same question through createAskDb + @askdb/ai-openai
pnpm lab ask --db postgres --sql "SELECT 1"       # skip the model: SQL, validation outcome, rows
pnpm lab ask --db postgres --model live "…"       # the live OpenAI model, any question (needs OPENAI_API_KEY; never in CI)
pnpm lab ui                                       # one input on the engines you pick, side by side, replay or live, raw or client
pnpm lab:test
pnpm lab:matrix                                   # the suite as a scenario × dialect table (.lab/matrix.json)
pnpm lab:use --restore                            # before committing: restore the lab's manifests
pnpm lab:down                                     # stop the fixture; its data and the lab install stay
pnpm lab:reset                                    # start over: fixture reseeded, committed baseline reinstalled
```

`lab:down` removes only the fixture's containers (`fixture:down`) and the lab's own Postgres (`examples/consumer-lab/compose.yml`, whose data is on a tmpfs): the fixture's volumes, the SQLite file, the lab's `node_modules` and `.lab/` stay, so the next `lab:up` is fast. `lab:reset` runs `fixture:reset` (containers, volumes and the SQLite file removed, then started and reseeded), then `lab:use --restore`, which removes `.lab/` (tarballs, the recorded target, cached schema artifacts, scratch projects) and the lab's `node_modules`, checks out the lab's three manifests as committed, and installs and verifies the committed lockfile, then restarts the lab's Postgres empty (the `tenant-rls` test seeds it). It works from a half-finished `lab:use`. It leaves the committed `npm:latest` baseline installed, not this checkout; run `pnpm lab:use .` to install the checkout. Neither command touches anything else. To try them without stopping a fixture others are using, run a [second copy of the fixture](fixtures/multi-engine/README.md#running-a-second-copy) from another worktree.

On the replay model, `lab ask` answers only questions in the lab's catalog, from hand-written replies per dialect (`--model live` answers anything and grades catalog questions against the oracle); adding a question means adding its replies and its oracle, the expected answer computed from the seed data, which `test/results.test.ts` compares with the rows every engine returns (see the lab README).

Lab test names start with `[<dialect>] <scenario-id>`, which is how `lab:matrix` places each result; the cell values and how to mark a known bug are in the [lab README](examples/consumer-lab/README.md#the-matrix). `lab:matrix` exits non-zero on any `FAIL` cell, and CI's `consumer-lab` job runs it on every pull request (docs-only ones excepted) against tarballs packed from the PR; see [In CI](examples/consumer-lab/README.md#in-ci).

`lab:use` rewrites the lab's `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. The committed versions are the `npm:latest` baseline, so don't commit them after any other target (a tarball install writes `file:` paths into them). To refresh the baseline after a release ships, run `pnpm lab:use npm:latest` and commit those three files. Unlike the package suites above, lab tests don't use `integrationSuite()`: the lab exists to run against real databases, so a missing fixture or install fails the suite instead of skipping it. The one exception is an older target that lacks a documented capability a scenario needs: that scenario reports `n/a (capability: …)` (see the lab README).

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
| GHSA-ch52-4w7c-c8xp | `http-cache-semantics` via `astro` (`apps/docs-site` only) | High severity: `max-stale` handling in a shared cache can disclose one user's cached response to another. `astro` uses it only to cache remote images fetched during the static docs build, which has no users to share a cache between, and `apps/docs-site` is private, so it isn't in any published package. | A patched `http-cache-semantics` (> 4.2.0) is released |
| GHSA-vfj7-8cjw-p6xm | `braces` via `starlight-llms-txt > micromatch` (`apps/docs-site` only) | High severity: deeply nested braces patterns exhaust the stack. `starlight-llms-txt` matches doc IDs against its own default patterns (`astro.config.mjs` sets none), so no attacker-controlled pattern reaches it, and `apps/docs-site` is private, so it isn't in any published package. | A patched `braces` (> 3.0.3) is released |
| GHSA-hp3w-g68c-fv3c | `sprintf-js` via `gray-matter > js-yaml > argparse` (`packages/core` only) | Moderate severity: unbounded precision specifiers in `sprintf-js` can cause DoS. `gray-matter` only uses `js-yaml` to parse front-matter in schema files (trusted input, not user-controlled), and `@askdb/core` is a library that doesn't expose a sprintf surface to attackers. No patched `sprintf-js` version exists yet. | A patched `sprintf-js` (>= 1.1.4) is published |
| GHSA-hp3w-g68c-fv3c | `sprintf-js` via `tedious` (`packages/sqlserver`, `fixtures/multi-engine`, `apps/studio` only) | Moderate severity: same as above. `tedious` (SQL Server driver) uses `sprintf-js` only for internal TDS packet formatting with trusted, internally-generated values. These packages are dev-only or not published (`fixtures/multi-engine` is a test fixture). No patched `sprintf-js` version exists yet. | A patched `sprintf-js` (>= 1.1.4) is published |

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

A change that alters no behavior and no public type (tests, or comments outside exported declarations) but still trips the Changesets check takes an empty one instead: `pnpm changeset --empty`.

AskDB is currently pre-1.0. Breaking public API changes should normally use a minor changeset unless the project intentionally moves a package to 1.0.

Releases are automated: merged changesets collect in a "chore: version packages (beta)" PR, and merging it publishes to npm after a maintainer approves. See [`docs/release.md`](docs/release.md).

## Safety Boundary

AskDB public surfaces return generated SQL for review. They do not execute generated SQL. Any downstream execution must happen under the integrator's own database roles, read-only controls, tenant policy, approval process, and audit logging.

Never commit real `.env` files, API keys, database credentials, customer schemas, or production query outputs.
