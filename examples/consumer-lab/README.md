# AskDB consumer lab

A black-box test bed for AskDB. The lab installs AskDB the way an outside project would: from tarballs packed from a checkout or a git ref, or from npm. It drives AskDB only through documented surfaces, and it acts as the host, executing the returned SQL on the shared [multi-engine fixture](../../fixtures/multi-engine/README.md).

- Design: [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).
- Work tracked in: #241.

This directory is **not** a member of the AskDB pnpm workspace. It is its own pnpm root with its own lockfile, so it never resolves `workspace:` links.

## Commands

From the repo root:

```bash
pnpm lab:up                          # start and seed the fixture; install `.` unless a verified install exists
pnpm lab:use .                       # pack this checkout's publishable packages and install them
pnpm lab:use ../other-checkout       # …or another checkout's
pnpm lab:use git:origin/main         # …or a branch, tag or commit's (built in a temporary worktree)
pnpm lab:use npm:latest              # published packages under a dist-tag (npm:beta, …)
pnpm lab:use npm:askdb@1.0.0-beta.40 # a published CLI release and the @askdb/* versions it depends on
pnpm lab:use --check                 # re-verify the current install against its target
pnpm lab ask --db mysql "How many active programs does each agency run?"
pnpm lab ask --db sqlserver --via client "Which three agencies have the highest paid order total?"
pnpm lab ask --db postgres --sql "SELECT agency_id, name FROM org.agency"
pnpm lab:test                        # the lab's own suite (needs the fixture and an installed lab)
pnpm lab:matrix                      # lab:up, then the suite as a scenario × dialect table
pnpm lab:matrix -t introspect-golden # vitest flags pass through: one scenario (-t), one dialect (-t '\[mysql\]'), one file
pnpm lab:use --restore               # put the committed baseline (npm:latest) back
pnpm lab:down                        # stop the fixture; keep its data and the lab install
pnpm lab:reset                       # reseed the fixture from scratch and put the committed baseline back
```

`--db` is any fixture engine: `postgres`, `mysql`, `mariadb`, `sqlserver` or `sqlite`.

## Stopping and resetting the lab

| Command | Removes | Keeps |
|---|---|---|
| `pnpm lab:down` | The four fixture containers, stopped and removed (`pnpm fixture:down`). | The fixture's volumes and SQLite file, and the lab's `node_modules`, `.lab/` and manifests. A following `pnpm lab:up` reuses the seeded data and skips the install when it still matches the checkout. |
| `pnpm lab:use --restore` | The lab's `.lab/` (tarballs, the recorded target, cached schema artifacts, scratch projects) and `node_modules`. It checks the lab's `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` out as committed, then installs and verifies the committed lockfile. | Everything else, including other edits in the lab. |
| `pnpm lab:reset` | The fixture's containers, volumes and SQLite file (`pnpm fixture:reset`, which then starts and reseeds it), then everything `pnpm lab:use --restore` removes. | Everything else. |

`lab:reset` recovers from any lab state, a half-finished `lab:use` included. It clears `.lab/` together with the fixture because cached schema artifacts are keyed on the install target, not on the fixture's data. Afterwards the fixture is freshly seeded and the committed baseline (`npm:latest`) is installed, not this checkout: run `pnpm lab:use .` (or `pnpm lab:up`) to install the checkout.

To run a second copy of the fixture beside the usual one (for example, to try `lab:reset` while other lab runs use the fixture), set `COMPOSE_PROJECT_NAME` and the `ASKDB_FIXTURE_<ENGINE>_PORT` variables (see the [fixture README](../../fixtures/multi-engine/README.md#running-a-second-copy)). The lab's `.lab/`, `node_modules` and the SQLite file belong to the checkout, so use a separate worktree for it.

## `pnpm lab ask`

`pnpm lab ask --db <dialect> "<question>"` asks AskDB a question from the [catalog](#the-question-catalog-and-its-replies). No API key is needed: the model is the lab's replay server (`src/model/replay-server.ts`), a local OpenAI-compatible server that answers from hand-written replies. `--via` picks which of the two documented model paths calls it:

| `--via` | Path |
|---|---|
| `raw` (default) | A Vercel AI SDK `LanguageModel`, `createOpenAI({ baseURL, apiKey })` from `@ai-sdk/openai`, passed to `ask()` from `@askdb/core`. |
| `client` | `createAskDb` from `@askdb/client` with `openaiProvider` from `@askdb/ai-openai`. The model comes from the lab's `askdb.config.ts`, whose `providerConfig.openai.baseUrl` reads `LAB_REPLAY_BASE_URL`. `lab ask` sets it. |

Both paths must send the same prompt and return the same SQL; `lab:test` checks that on every dialect.

`--sql "<sql>"` skips the model. The SQL goes through `ask()` as if a model had written it, through the documented `deps.generateText` seam.

`lab ask` prints:

- the install target, the dialect and the model path;
- `prompt:`, the length and a digest of the prompt the replay server received;
- the SQL;
- the validation outcome (`ok`, or the error class and rule code, such as `SqlValidationError SQL_NOT_SELECT_OR_WITH`);
- for accepted SQL, the rows.

A question with no reply fails: `lab ask` exits 1 and says which file to add. There is no default reply.

The schema artifact comes from the installed `askdb introspect`, run as the read-only role, and is cached per install target under `.lab/artifacts/`. MySQL and MariaDB are introspected with `--schemas org,people,billing,ref` (one database per logical schema); MariaDB uses the `mysql` engine. SQLite has no URL, so the lab writes a config with `introspection.providerConfig.sqlite.file` into a fresh scratch directory under `.lab/` and introspects from there, as `guides/switch-engines` documents.

### Executing the SQL

The lab is the host, so it executes accepted SQL as `run-safely-in-prod` asks: as `fixture_reader`, with a 5-second statement timeout and a 100-row cap. Rejected SQL is never executed.

| Engine | Read-only | Timeout | Row cap |
|---|---|---|---|
| Postgres | `BEGIN READ ONLY` | `statement_timeout` | the guide's `SELECT * FROM (…) LIMIT n` wrapper |
| MySQL | `START TRANSACTION READ ONLY` | `max_execution_time` | stops reading after 101 rows |
| MariaDB | `START TRANSACTION READ ONLY` | `max_statement_time` | stops reading after 101 rows |
| SQL Server | the role only (no read-only transaction exists) | request timeout, which cancels the statement | `SET ROWCOUNT 101` |
| SQLite | read-only handle with `query_only` | the child process running it is killed (a worker thread can't be stopped inside the native driver) | stops reading after 101 rows |

The guide's wrapper is invalid on SQL Server and drops the statement's `ORDER BY` on MariaDB (#266), so only Postgres uses it.

## The question catalog and its replies

- `scenarios/questions.json` lists the questions: `{ "id", "text" }`. The texts must be unique, because the replay server finds the question by looking for its text in the prompt.
- `cassettes/<dialect>/<id>.json` holds the reply for one question on one dialect:

  ```json
  { "question": "<the catalog text>", "reply": "```sql\nSELECT …\n```", "source": "authored" }
  ```

  The reply is the model's whole answer, fences included. For now every reply is `"source": "authored"`: hand-written SQL, correct for its dialect (for example, the reserved-word table is `billing."order"` on Postgres, ``billing.`order` `` on MySQL and MariaDB, `billing.[order]` on SQL Server and `"order"` on SQLite). Recording replies from a live model comes with `pnpm lab:record` (#247).

To add a question, add it to the catalog and add a reply for each of the five dialects. `lab:test` runs every catalog question on every dialect.

The replay server serves:

- `POST /<dialect>/v1/responses`, the Responses API that `openai(model)` uses;
- `POST /<dialect>/v1/chat/completions`, for `openai.chat(model)` and other OpenAI-compatible clients;
- `GET /__lab/requests`, every request received, with its prompt text and the question it matched, for suites that assert on prompts.

The dialect comes from the base URL: `http://127.0.0.1:<port>/<dialect>/v1`. The server uses Node built-ins only and never imports AskDB.

## The matrix

`pnpm lab:matrix` runs `lab:up` (idempotent: it installs only if the lab never was, so it tests whatever `lab:use` last installed), then the whole suite with `src/matrix-reporter.ts`. The reporter prints a `scenario × dialect` table and writes it to `.lab/matrix.json` (and to `$GITHUB_STEP_SUMMARY` when that is set). It builds every test row from test results, never from a hand-kept list:

- A test's full name starts with `[<dialect>] <scenario-id>`, usually as `describe("[mysql]")` around `it("introspect-golden: …")`. Tests that share a scenario and dialect share a cell.
- `pass`: every test in the cell passed. `FAIL`: one failed, or its suite's hook did.
- `known (#N)`: an `it.fails` test that names its `discrepancy` issue, for example `it.fails("… (#239)")`, failed as expected. Once the bug is fixed the test passes, `it.fails` turns that into a failure, and the cell shows `FAIL` until the marker is removed.
- `n/a (capability: …)`: a capability gate skipped the test because the install target lacks a documented capability (see [Capabilities](#capabilities-testing-older-targets)). Any other skip of a test that was meant to run is a `FAIL`: the lab fails rather than skips.
- `-`: no test ran for that dialect (none exists yet, or a `-t` filter excluded it; an excluded test never inherits a sibling's failure).

`lab:matrix` exits 1 when any cell is `FAIL`, including the two that vitest itself counts as passing (an `it.fails` test that names no issue, and a skip that isn't a capability gate). `pass`, `n/a` and `known` cells don't fail it. The failing cells are listed under the table.

Below the test rows, the `unique-constraints *` and `view-marker *` rows are **annotations, not test results**: facts the golden schema holds but the schema artifact can't express (the "Not comparable" rule in [`NORMALIZATION.md`](../../fixtures/multi-engine/dataset/NORMALIZATION.md)). The reporter prints them as `n/a (not in the schema artifact)` from a static list, and `matrix.json` keeps them under `annotations`.

### In CI

The `consumer-lab` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every pull request and every push to `main`. It runs `pnpm lab:use .` (tarballs packed from the commit under test), then `pnpm lab:matrix`, with a 25-minute timeout. The table goes to the job summary, followed by a collapsible block per failing test with the reason it failed (the assertion message, or the rule that made a passing test a failure) and any unhandled errors; the full stack traces are in the step log. `.lab/matrix.json` holds the same reasons (a `FAIL` cell's `failures`), and is uploaded as the `consumer-lab-matrix` artifact whether the job passes or fails. The job fails exactly when `lab:matrix` exits non-zero. Docs-only pull requests skip it: those whose every changed file is under `apps/docs-site/`, `docs/` or `plans/`, a top-level `*.md`, or a `README.md` or `CHANGELOG.md`. Other Markdown still runs the lab, because schema artifacts are Markdown too.

## Introspection

`test/introspection.test.ts` introspects every fixture database with the installed `askdb introspect`, as the docs site describes for each engine: `--engine`, `--url` (the read-only role) and `--schemas org,people,billing,ref` for Postgres, SQL Server, MySQL and MariaDB (`--engine mysql`), and `introspection.providerConfig.sqlite.file` in an `askdb.config.ts` for SQLite. That config is written to a fresh directory under `.lab/projects/` for each run (concurrent runs never share one), so its `@askdb/config` import resolves from the lab's `node_modules`. Each artifact is compared with the fixture's golden schema, loaded with `loadSchema`, and bundled with `askdb bundle`. The drivers the CLI needs (`pg`, `mysql2`, `mssql`, `better-sqlite3`) are the lab's own dependencies, as the CLI reference asks of a consumer project.

## Install targets

| Target | What gets installed |
|---|---|
| `.` or `<path>` | Tarballs packed from that checkout with `scripts/pack-tarballs.sh`, the same step `pnpm smoke:install` uses, into `.lab/tarballs/`. |
| `git:<ref>` | Tarballs packed from `<ref>`. `lab:use` adds a temporary detached `git worktree` in the system temp directory, runs `pnpm install --frozen-lockfile` there, packs it with **this** checkout's pack script (`--root`, so refs older than the script pack too), then removes the worktree. Fetch remote refs first. |
| `npm:<dist-tag>` | Each direct AskDB dependency at that dist-tag, and every `@askdb/*` package reachable from them through dependencies and peer dependencies, each at its own version under the tag. A package without the tag keeps the version its dependent asks for. |
| `npm:askdb@<version>` | That CLI release, and the exact `@askdb/*` versions it depends on (read from the published manifests with `npm view`, recursively). Package versions aren't in lockstep, so the CLI release decides. A direct dependency that isn't in its tree is left out, with a message. |

`registry` (a local verdaccio) arrives in #257.

## How `lab:use` pins the target

1. It works out the target's packages and versions (packing tarballs, or reading the published manifests).
2. It points the lab's direct AskDB dependencies (`DIRECT` in `src/use.mjs`) at the target: `file:` tarball paths, or exact published versions.
3. It writes a pnpm `overrides` block into `pnpm-workspace.yaml` covering **every** target package, headed by a `# lab:use target:` comment. Without it, a transitive `@askdb/*` dependency would resolve from npm under the same version number, so the lab would quietly test the published code instead of the checkout, or another release than the one asked for.
4. It installs, then reads the lockfile and prints each `@askdb/*` package's version and source. It fails if any package isn't from the target's source (tarball, or registry), isn't at the target's version, or wasn't pinned by the target at all. `pnpm lab:use --check` repeats this check on the current install.

`lab:use` rewrites `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. The committed versions are the **`npm:latest` baseline** (decision 2 in the spec): `latest` is what `npm install askdb` resolves, so it's what users run. `pnpm lab:use --restore` brings them back: it removes `.lab/` and `node_modules`, reinstalls the committed lockfile as-is and verifies it against the pins in the committed overrides block.

- **Don't commit the three files after `.`, a path or `git:`**: they hold `file:` tarball paths. Don't commit them after another npm target either.
- **To refresh the baseline** after a release ships, run `pnpm lab:use npm:latest` and commit the three files.
- `npm:beta` still works as a target, but the `beta` dist-tags are stale (#267): its CLI can't read the lab's `askdb.config.ts`, so `pnpm lab:test` fails against it.
- The lab's typecheck (`pnpm -C examples/consumer-lab lint`) is against the installed target too, so run it after `pnpm lab:use .`.

The lab sets no `minimumReleaseAge`, and it doesn't inherit the monorepo's (it is its own pnpm root). pnpm 11.22 applies no release-age delay without that setting (checked by installing a package published six hours earlier into a standalone pnpm root), so a just-published release installs straight away. If a later pnpm adds a default, add `minimumReleaseAgeExclude: ["askdb", "@askdb/*"]` to the lab's `pnpm-workspace.yaml`.

The baseline pins the lab's third-party dependencies exactly: the drivers (`pg`, `mysql2`, `mssql`, `better-sqlite3`), and `ai`, `@ai-sdk/openai` and `zod` at the versions the workspace uses. The AskDB adapters declare `ai` as a peer, so the host pins it.

`askdb` depends on `@askdb/prisma`, whose `@prisma/engines` has a postinstall script that pnpm 11 won't run until it's approved. The lab approves it in `pnpm-workspace.yaml`, as a pnpm user would have to (#259). It approves the `better-sqlite3` build the same way.

## Capabilities: testing older targets

A scenario may need a documented capability that an older target lacks. It declares that by calling `needsCapability(ctx, "<capability>")` from `src/capabilities.ts` first. When the installed target lacks the capability, the test is skipped with the note `capability: <capability>`, which the suite's verbose reporter prints and `lab:matrix` shows as `n/a (capability: <capability>)`.

Capabilities are detected from the installed target's public surface: an export, documented `--help` output, or the documented behavior itself (a probe that runs the documented command). They are never detected from version strings. Only a surface that works but lacks the capability counts as absent. A missing `askdb` bin, a crash, or a non-zero exit from `--help` is a broken install, and the test fails. When the target is this checkout (`lab:use .`), a missing capability fails the test instead: the lab is written against this checkout's docs, so there it's a regression.

| Capability | Detected by | Used by |
|---|---|---|
| `cli-introspect-engine` | `askdb introspect --help` documents `--engine` (`reference/cli.mdx`), when run with the lab's config | every scenario that builds a schema artifact (`test/lab-ask.test.ts`) |
| `mysql-databases` | `askdb introspect --schemas org,people,billing,ref` on the fixture's MySQL returns a table from a database other than the connection's (`reference/cli.mdx`, `guides/switch-engines.mdx`) | MySQL and MariaDB `introspect-golden` / `introspect-loads` (`test/introspection.test.ts`) |

To add one, add a detector to `DETECTORS` in `src/capabilities.ts`, citing the docs page that documents the capability.
