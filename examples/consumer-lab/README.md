# AskDB consumer lab

A black-box test bed for AskDB. The lab installs AskDB the way an outside project would: from tarballs packed from a checkout or a git ref, or from npm. It drives AskDB only through documented surfaces, and it acts as the host, executing the returned SQL on the shared [multi-engine fixture](../../fixtures/multi-engine/README.md).

- Design: [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).
- Work tracked in: #241.
- Agents driving the lab (choosing a target, triaging the matrix, refreshing the baseline after a release) follow the [`consumer-lab` skill](../../.agents/skills/consumer-lab/SKILL.md).

This directory is **not** a member of the AskDB pnpm workspace. It is its own pnpm root with its own lockfile, so it never resolves `workspace:` links.

## Commands

From the repo root:

```bash
pnpm lab:up                          # start and seed the fixture, start the lab's Postgres; install `.` unless a verified install is current or was chosen with lab:use
pnpm lab:use .                       # pack this checkout's publishable packages and install them
pnpm lab:use ../other-checkout       # …or another checkout's
pnpm lab:use git:origin/main         # …or a branch, tag or commit's (built in a temporary worktree)
pnpm lab:use npm:latest              # published packages under a dist-tag
pnpm lab:use npm:askdb@1.0.0-beta.40 # a published CLI release and the @askdb/* versions it depends on
pnpm lab:use --check                 # re-verify the current install against its target
pnpm lab ask --db mysql "How many active programs does each agency run?"
pnpm lab ask --db sqlserver --via client "Which three agencies have the highest paid order total?"
pnpm lab ask --db postgres --sql "SELECT agency_id, name FROM org.agency"
pnpm lab ui                          # a page on 127.0.0.1 that runs one input on every engine side by side
pnpm lab:test                        # the lab's own suite (needs the fixture, the lab's Postgres and an installed lab)
pnpm lab:matrix                      # lab:up, then the suite as a scenario × dialect table
pnpm lab:matrix -t introspect-golden # vitest flags pass through: one scenario (-t), one dialect (-t '\[mysql\]'), one file
pnpm lab:use --restore               # put the committed baseline (npm:latest) back
pnpm lab:down                        # stop the fixture and the lab's Postgres; keep the fixture's data and the lab install
pnpm lab:reset                       # reseed the fixture from scratch and put the committed baseline back
```

`--db` is any fixture engine: `postgres`, `mysql`, `mariadb`, `sqlserver` or `sqlite`.

## Stopping and resetting the lab

| Command | Removes | Keeps |
|---|---|---|
| `pnpm lab:down` | The four fixture containers, stopped and removed (`pnpm fixture:down`), and the [lab's Postgres](#row-level-security-informational) with its data, which is on a tmpfs. | The fixture's volumes and SQLite file, and the lab's `node_modules`, `.lab/` and manifests. A following `pnpm lab:up` reuses the seeded data and skips the install when it still matches the checkout. |
| `pnpm lab:use --restore` | The lab's `.lab/` (tarballs, the recorded target, cached schema artifacts, scratch projects) and `node_modules`. It checks the lab's `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` out as committed, then installs and verifies the committed lockfile. | Everything else, including other edits in the lab. |
| `pnpm lab:reset` | The fixture's containers, volumes and SQLite file (`pnpm fixture:reset`, which then starts and reseeds it), then everything `pnpm lab:use --restore` removes, then the lab's Postgres and its data, which it starts again empty. | Everything else. |

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
- the SQL, and for parameterized output `unbound:` (the `unboundSql`) and `params:`;
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

## `pnpm lab ui`

`pnpm lab ui [--port <port>] [--timeout <ms>]` serves one page on `127.0.0.1` (a free port unless `--port` names one) and prints its URL. Enter an input once, as a catalog question, a free-text question, or raw SQL, and the page runs it on all five engines at once, one column per engine; the row of columns scrolls sideways when it doesn't fit.

Each column shows what `pnpm lab ask --db <engine>` prints for the same input, because both run the same module (`src/ask-run.ts`): the SQL (with `unbound:` and `params:` when present), the validation outcome or the error class and rule code, the sensitive-column note, and the rows the read-only role read with their count. Its header adds the status, the row count, the exit code `lab ask` would return, and how long `ask()` and the execution took. A column appears as soon as its engine finishes, and an engine that fails (down, rejected SQL, an execution error) fails only its own column. An engine with no result after `--timeout` (default 60 s) is shown as timed out; its work isn't cancelled (no driver call takes a signal), so a hung connection stays open until it ends or `lab ui` stops.

The summary strip says whether the engines agree and whether each matches the [oracle](#why-the-expected-answer-never-comes-from-sql). Both compare rows with the fixture's normalization rules, which need each column's logical type, and only a catalog question's oracle declares those. So a catalog question, or raw SQL labelled with the catalog question it answers, is compared; any other input is shown but not compared. An engine that failed, or whose result the row cap cut, isn't compared either.

The header names the install target (`lab:use`'s label) and the model mode: `replay`, since a live model doesn't exist yet (#247), so a free-text question outside the catalog gets the replay server's refusal on every engine. Questions always take the raw-model path: `--via client` reads `askdb.config.ts` once per process, which would pin every engine to the first engine's replay URL, so it stays a `lab ask` option. The target is the one installed when `lab ui` started, whose modules it loaded: if `lab:use` switches targets while it runs, the page and the API answer `409` until it's restarted.

Like Studio's server ([ADR 0009](../../docs/adrs/0009-studio-local-api-protection.md)), it binds loopback only and answers `403` to any request whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>`, the page included, which stops DNS rebinding. `POST /api/run` also needs `Content-Type: application/json` (`415`) and a same-origin `Origin` when one is sent (`403`), so another site can't make the browser run SQL. There is no session token: the page holds no secret, and the SQL runs as the read-only role. A forwarded port that rewrites `Host` (a devcontainer, a remote preview browser) is refused.

## The question catalog and its replies

- `scenarios/questions.json` lists the questions: `{ "id", "text" }`. The texts must be unique, because the replay server finds the question by looking for its text in the prompt.
- `cassettes/<dialect>/<id>.json` holds the reply for one question on one dialect:

  ```json
  { "question": "<the catalog text>", "reply": "```sql\nSELECT …\n```", "source": "authored" }
  ```

  The reply is the model's whole answer, fences included. For now every reply is `"source": "authored"`: hand-written SQL, correct and idiomatic for its dialect (for example, the reserved-word table is `billing."order"` on Postgres, ``billing.`order` `` on MySQL and MariaDB, `billing.[order]` on SQL Server and `"order"` on SQLite, and a non-ASCII string literal is `N'…'` on SQL Server). Recording replies from a live model comes with `pnpm lab:record` (#247).
- A reply to a question that holds a value (`programs-started-since` asks about `2022-01-01`) follows the NL→SQL prompt's parameterized output format, as a model would: the bound statement in a ```` ```sql ```` fence, the same statement with `:name` placeholders in a ```` ```sql-unbound ```` fence, and a ```` ```json ```` fence with the parameter manifest.
- `src/oracle.ts` holds each question's expected answer, computed in TypeScript from the fixture's seed data (`fixtures/multi-engine/dataset/data/*.json`), with its columns' logical types and whether its row order is part of the answer. It never runs SQL, the cassette's or any other.

To add a question, add it to the catalog, add a reply for each of the five dialects, and add its oracle. `lab:test` runs every catalog question on every dialect. The tenant suite keeps its own catalog, `scenarios/tenant-questions.json` (see [Tenant scoping](#tenant-scoping)), and so does the sensitive-column suite, `scenarios/sensitive-questions.json` (see [Sensitive columns](#sensitive-columns)).

## Question → SQL → execute

`test/results.test.ts` asks every catalog question through `ask()` with the raw-model path, executes the SQL it returns as the host does (above), normalizes the rows by [`NORMALIZATION.md`](../../fixtures/multi-engine/dataset/NORMALIZATION.md) and compares them with the question's oracle. Each question is its own matrix row, named by its id. Every dialect is compared with the same oracle, so the five engines also agree with each other. A question with no oracle fails.

### Why the expected answer never comes from SQL

A common first reading of this suite is that it checks answers without running queries. It doesn't: every question's SQL runs on all five engines, and those rows are what the test measures. Only the *expected* rows are computed without SQL, by the oracle, from the seed data. That split is deliberate:

- **Expected rows from the same SQL** (the reply's own statement) would compare the query with itself. The test would pass whatever the SQL returns, which the test-audit skill rejects as a self-comparison. During the #246 break-it proof, a MySQL reply that joined on the wrong key returned 93 rows instead of 30. `lab-ask-replay` and `cli-ask-replay` stayed green, because they compare the SQL with the reply. This suite failed, because it compares the rows with the oracle.
- **Expected rows from one reference engine** (say, Postgres) would catch engines disagreeing. But a wrong answer on the reference engine would become the expected answer, and a reply wrong in the same way on every dialect would pass.
- **An oracle computed from the seed data** is independent of the SQL, the engines and AskDB (`src/oracle.ts` never imports AskDB or runs a query). A wrong oracle fails loudly: a one-cent error in `payments-per-agency` turned all five cells red. A false pass would need the oracle and all five replies to be wrong in the same way. The cost is a small second implementation per question, and a new question fails until its oracle exists.

What this suite proves: packed AskDB delivers a correct reply through extraction, validation and parameter binding without corrupting it, and the host path returns the right rows on every engine. What it doesn't prove: that a real model writes good SQL. The replies are hand-written, so their correctness is the cassette author's job. Live-model mode (#247) runs a real model, and because the oracle doesn't depend on the SQL, it grades the model's answers with the same oracle, whatever SQL the model writes.

| Question | Covers |
|---|---|
| `agency-names` | unicode text, ordered by a unique key |
| `active-programs-per-agency` | a boolean filter, `GROUP BY` with `COUNT(*)` |
| `unpaid-orders` | the reserved-word table, a boolean filter, decimals |
| `top-paid-agencies` | the view `billing.agency_revenue`, ordered top-N (`LIMIT`, `TOP`) |
| `client-agency-names` | a cross-schema join (`people` to `org`) |
| `enrollment-program-names` | the composite-FK join `(agency_id, program_code)` |
| `payments-per-agency` | `GROUP BY` with a decimal `SUM` |
| `orders-q1-2024` | a timestamp range that includes a leap day at 23:59:59 |
| `program-active-flags` | a boolean column in the result |
| `open-enrollments` | `IS NULL` |
| `client-named-sato` | a CJK equality match (`N'…'` on SQL Server) |
| `top-five-orders` | ordered top-N on a base table (`LIMIT`, `OFFSET … FETCH`) |
| `agency-parent-names` | a `LEFT JOIN` that produces NULLs |
| `distinct-enrolled-clients` | `COUNT(DISTINCT …)` |
| `programs-started-since` | a parameterized date literal |

On `programs-started-since`, the suite also checks the parameterized output contract (`reference/core-api.mdx`): `unboundSql` holds the dialect's driver markers (`$1`, `?`, `@p0`) instead of the literal, binding it with `params` through the real driver returns the same rows as `sql`, and `bindPreparedQuery` with another date returns that date's oracle rows from both its `sql` and its `unboundSql` + `params`.

The replay server serves:

- `POST /<dialect>/v1/responses`, the Responses API that `openai(model)` uses;
- `POST /<dialect>/v1/chat/completions`, for `openai.chat(model)` and other OpenAI-compatible clients;
- `GET /__lab/requests`, every request received, with its prompt text and the question it matched, for suites that assert on prompts.

The dialect comes from the base URL: `http://127.0.0.1:<port>/<dialect>/v1`. The server uses Node built-ins only and never imports AskDB.

## Safety

`test/safety.test.ts` sends adversarial model replies through the installed `ask()`, through the documented `deps.generateText` seam (the way `lab ask --sql` does). Each reply must be rejected with `SqlValidationError` and the rule code that `getting-started/troubleshooting.mdx` and the dialect's forbidden-keyword and blocked-function lists give it. A rejection under a different rule fails the test. The replies live in the test file, not in the question catalog or the cassettes.

| Scenario | Replies | Rule | Proven on a scratch copy |
| --- | --- | --- | --- |
| `safety-delete`, `safety-update`, `safety-insert`, `safety-drop`, `safety-alter`, `safety-truncate` | the statement on its own (`TRUNCATE` isn't generated for SQLite, which has none) | `SQL_NOT_SELECT_OR_WITH` | yes: the row count or column sum changes, or the table is gone or has a new column |
| `safety-multi-statement` | `SELECT 1 AS ok; DELETE FROM …` | `SQL_MULTI_STATEMENT` | yes: the rows are deleted |
| `safety-cte-dml` | Postgres `WITH gone AS (DELETE … RETURNING …) SELECT …`; `WITH … DELETE` where the engine has it (not MariaDB) | `SQL_FORBIDDEN_KEYWORD` | yes: the rows are deleted |
| `safety-select-into` | `SELECT * INTO billing.lab_copy FROM …` (Postgres, SQL Server) | `SQL_FORBIDDEN_KEYWORD` | yes: the new table exists and holds the rows |
| `safety-for-update` | `SELECT … FOR UPDATE` (Postgres, MySQL, MariaDB); `SELECT … WITH (UPDLOCK)` (SQL Server, `known (#319)`) | `SQL_FORBIDDEN_KEYWORD` | yes: a second connection with a short lock timeout can't lock the row until the first rolls back |
| `safety-comment` | `DELETE` in a `/* */` comment, `DROP TABLE` after `--`, and on MySQL and MariaDB after `#` and in a `/*! */` executable comment | `SQL_COMMENT` | ordinary comments are inert; executable `/*! */` OUTFILE is proven on the isolated copy |
| `safety-file-access` | `COPY … TO/FROM PROGRAM`, `INTO OUTFILE`, `LOAD_FILE()`, `EXEC xp_cmdshell` | as the rule list gives it | isolated copy only; see case table below |
| `safety-server-control` | `pg_terminate_backend()`, `KILL`, `SET GLOBAL` | as the rule list gives it | isolated copy only; see case table below |
| `safety-sleep` | `pg_sleep()`, `SLEEP()`, `WAITFOR DELAY` | as the rule list gives it | isolated copy only; see case table below |
| `safety-system-catalog` | `pg_catalog`, `information_schema`, MySQL's `mysql` and `sys`, SQL Server's `sys`, `sqlite_master` | rejected, per `concepts/safety-boundaries.mdx` (no rule code is documented) | no; every engine accepts them today, `known (#318)` |
| `safety-quoted-keyword` | `DELETE` as a quoted identifier, and `DROP TABLE … ; DELETE …` in a string literal | accepted, returned unchanged, and run as the read-only role | no |

A statement that starts with its verb (`DELETE`, `COPY`, `KILL`, `SET`) is rejected by the leading-keyword check before the keyword list is read, so its rule is `SQL_NOT_SELECT_OR_WITH`. T-SQL runs a batch without semicolons, so on SQL Server the lab puts `EXEC`, `KILL` and `WAITFOR` after a `SELECT`, where the keyword list is what rejects them.

The matrix checks rejection of file, OS, server-control and sleep replies without executing them. Their effect proofs run on a disposable second fixture owned by the lab (#323): CI's `consumer-lab` job runs them in its own step after the matrix, and locally you run `pnpm lab:use .` then `pnpm lab:safety:isolated` from the repository root; append `-t 'isolated effect'` to run only the additional proofs. This command never runs `lab:up` or reseeds the shared fixture. It starts, seeds, tests and removes Compose project `askdb-lab-isolated`, including its volumes, even after test failure or SIGINT/SIGTERM. It also seeds this checkout's SQLite file. Docker Engine 28+ and Compose 2.24.4+ are required; a local Unix-socket Docker daemon is required.

The runner fixes the host to `127.0.0.1` and the ports to Postgres 25432, MySQL 23306, MariaDB 23307 and SQL Server 21433. The database containers share an internal network with an isolated gateway and no host mounts. A TCP relay exposes only those loopback ports; its fixed configuration forwards only to these four containers, with IP forwarding disabled. Before seeding and each effect proof, the guard checks the actual connection string, published binding, Compose project/service labels, container identity, relay configuration, database network and volume ownership. URL-based drivers must receive canonical URLs without query parameters or fragments, so driver options cannot override the endpoint being checked. SQL Server named instances are rejected because instance discovery discards the explicit port. Setting `ASKDB_LAB_ISOLATED=1` alone grants no permission: a shared or remote endpoint fails before any effect statement runs.

A lock shared by this user's worktrees and an existing-project check refuse concurrent ownership; the runner never adopts an existing copy. After an uncatchable SIGKILL or machine crash, inspect the project and confirm its owning run has stopped. From the repository root, remove the entire copy using both Compose files (the override defines the relay and entry network):

```bash
ASKDB_FIXTURE_POSTGRES_PORT=25432 \
ASKDB_FIXTURE_MYSQL_PORT=23306 \
ASKDB_FIXTURE_MARIADB_PORT=23307 \
ASKDB_FIXTURE_SQLSERVER_PORT=21433 \
ASKDB_LAB_RELAY_CONFIG="$PWD/examples/consumer-lab/isolated-haproxy.cfg" \
docker compose -f fixtures/multi-engine/compose.yml \
  -f examples/consumer-lab/compose.isolated.yml \
  -p askdb-lab-isolated down -v
```

After successful teardown, remove the `askdb-lab-isolated.lock` directory under Node's `os.tmpdir()`. The runner prints startup, seed, guard, suite and teardown timings. The measured full run on the rebased checkout took 52.84 seconds with fresh volumes and schema artifacts, using cached images: startup 10.47, seeding 1.70, guard tests 2.26, safety suite 35.33 and teardown 2.35 (plus orchestration). This is 3.5% of the PR job's 25-minute budget; a [completed main CI job](https://github.com/Ygilany/AskDB/actions/runs/37221345533) took 5 minutes 30 seconds, so adding this local measurement projects about 6 minutes 23 seconds, before image pulls and CI variance. In CI ([run 37264776682](https://github.com/Ygilany/AskDB/actions/runs/37264776682)) the step took 56 seconds (startup 11.89, seed 1.53, guards 1.32, suite 28.83, teardown 10.84) and the whole `consumer-lab` job 5 minutes 13 seconds. That fits, so the PR job runs it: an effect that quietly stops happening on an engine would leave its rejection test passing while proving nothing, and an opt-in run only catches that when someone remembers to run it.

| Rejected case | Postgres | MySQL | MariaDB | SQL Server | SQLite |
| --- | --- | --- | --- | --- | --- |
| `COPY … TO PROGRAM` | writes container-local sentinel file | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM |
| `COPY … FROM PROGRAM` | imports sentinel status row | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM | n/a: no COPY PROGRAM |
| `INTO OUTFILE`, including `/*!50000 … */` | n/a: no OUTFILE | file equals seeded agency IDs | file equals seeded agency IDs | n/a: no OUTFILE | n/a: no OUTFILE |
| `LOAD_FILE()` | n/a: no LOAD_FILE | reads exact container sentinel | reads exact container sentinel | n/a: no LOAD_FILE | n/a: no LOAD_FILE |
| `EXEC xp_cmdshell` | n/a: no xp_cmdshell | n/a: no xp_cmdshell | n/a: no xp_cmdshell | n/a: disabled; verifies configuration and error 15281 | n/a: no xp_cmdshell |
| `pg_terminate_backend()` / `KILL` | owned victim session disappears | owned victim session disappears | owned victim session disappears | owned victim session disappears | n/a: no server sessions |
| `SET GLOBAL max_connections` | n/a: different configuration syntax | value changes and is restored | value changes and is restored | n/a: different configuration syntax | n/a: no server settings |
| `pg_sleep(1)` / `SLEEP(1)` / `WAITFOR DELAY` | elapsed ≥900 ms | elapsed ≥900 ms | elapsed ≥900 ms | elapsed ≥900 ms | n/a: no built-in sleep |

The executable statements use bounded sentinel effects: program output goes only to a container file or scratch row; file reads use a lab-created file in MySQL's permitted directory (MariaDB uses `/tmp`); session IDs come from a second connection created by the proof; setting changes are restored in `finally`; sleeps last one second. Every exact statement, including dynamically addressed session IDs and setting values, is also rejected by installed `ask()` under its documented rule. Ordinary comments contain no executable effect; system-catalog queries remain rejection checks tracking #318, and quoted-keyword cases remain accepted read-only controls.

### Scratch databases

A scratch copy is a writable, throwaway copy of the fixture that the lab creates, resets and drops itself (`src/scratch.ts`). A safety proof runs its statement on one as the engine's owner, and never on the fixture's own databases.

| Engine | Scratch copy |
| --- | --- |
| Postgres, SQL Server | a database, `lab_scratch_<token>`, holding the fixture's schemas |
| MySQL, MariaDB | one database per logical schema: `lab_scratch_<token>_org`, `…_people`, `…_billing`, `…_ref` and `…_fixture` |
| SQLite | a file, `.lab/scratch/lab_scratch_<token>.sqlite` |

Each copy is built from the fixture's DDL (`fixtures/multi-engine/dataset/ddl/<engine>.sql`) and its rows (`loadRows`). The lab rewrites the database names that the MySQL and MariaDB DDL hardcodes. It also cuts the read-only role section from each server engine's DDL, because that section changes server-level principals the shared fixture owns. A scratch copy is therefore owner-only. The fixture's seeder is not imported: its source is part of the fixture's dataset hash. `<token>` is random for each copy, so lab runs that share a fixture never share a scratch copy. The safety suite and the [Studio suite](#studio) reset their copy before each proof and drop it when the suite ends. A run that is killed can leave a copy behind; its names start with `lab_scratch_`.

## Tenant scoping

`test/tenant.test.ts` asks tenant-scoped questions through `ask()` with a tenant policy, executes the SQL as the host does, and compares the rows with the oracle kept to the scope's agencies. The design is "Tenant scoping, by behavior" in [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).

- **The policy.** `scenarios/overlay/tenant-policy.md` is written in the documented format ([`docs/contracts/tenant-policy.md`](../../docs/contracts/tenant-policy.md)): the flat root `org.agency` (`agency_id`), the six tenant tables and the `billing.agency_revenue` view as scoped tables (`order_line` through a join to `order`), and `ref.status` as global. `src/tenant.ts` copies each dialect's introspected artifact into a fresh directory under `.lab/artifacts/tenant/` and writes the policy there, with each stable ID mapped to that artifact's namespace (SQLite's tables are all under `public`) and `enforcement` set per scenario. The introspected artifacts stay policy-free for the other suites.
- **The catalog.** The suite has its own questions, `scenarios/tenant-questions.json`, all with ids starting `tenant-`, and their replies in `cassettes/<dialect>/tenant-*.json`. The results suite never reads them. The scoped replies filter on the `:tenant_agency_ids` placeholder the NL→SQL prompt asks for, each in a different shape: `agency_id = :p`, `c.agency_id IN (:p)` on a join to the root table, `order_line` through its order, a decimal `SUM` per agency, and a business parameter next to the tenant one. The other replies are the "model" as the attacker: no filter, the tenant column selected but not filtered, another tenant's ID, `OR 1 = 1`, and the root table read unfiltered.
- **The resolver.** The lab is the host, so it supplies `resolveTenantDescendants` (`agencyDescendants` in `src/tenant.ts`): a recursive query over `org.agency.parent_agency_id`, as in the multi-tenancy guide, run on each engine as the read-only role (`WITH` on SQL Server, `WITH RECURSIVE` elsewhere).
- **The oracle.** `src/tenant-oracle.ts` computes each question's answer from the seed data, kept to a set of agencies. Which agencies a scope sees is decision 9's table, written down (1 sees 1, 4, 5 and 6; 5 sees 5 and 6; 6 sees 6; 7 sees 7), not computed, so a wrong resolver can't also move the expected answer.

| Scenario | What it checks |
|---|---|
| `tenant-ids` | Every scoped question, in `sql-only` and `sql-params` mode, with `ids: ["2"]`: every executable pair (`sql` with `tenantParams`, and `unboundSql` with `params` when present) returns agency 2's rows, and not those of its child 7. |
| `tenant-ids-hostile` | In `sql-only` mode, the tenant ID `2' OR '1'='1` (and on MySQL and MariaDB `2\' OR 1=1 -- `) is escaped: run as the host, the SQL returns no row outside agency 2, or the engine refuses to compare the integer column with the string. |
| `tenant-subtree` | The same questions with `subtree` access from agencies 1, 5, 6 and 7 and the lab's resolver: exactly the visible agencies' rows, and the resolver is called once with the root and the seed. |
| `tenant-subtree-seeds` | A resolver that returns strict descendants only (agency 1 still sees 1, 4, 5 and 6, because `ask()` unions the seeds in), and two seeds at once (5 and 2 see 2, 5, 6 and 7). |
| `tenant-strict-unfiltered` | A reply with no tenant filter returns every agency's rows when run raw, and strict mode rejects it with `TenantGuardrailError`. |
| `tenant-strict-column-only`, `-wrong-tenant`, `-or-true`, `-root-table` | Each reply, run raw, returns rows outside agency 2, and strict mode rejects it with `TenantGuardrailError` (#315). If strict mode returns the SQL instead, the test runs it and fails on the leaked rows. |
| `tenant-warn` | With `enforcement: warn`, the unfiltered reply's SQL is returned, and `tenantGuardrail` reports `MISSING_TENANT_PREDICATE`. |
| `tenant-warn-claims` | The docs name warn mode's warnings `tenantWarnings`; `ask()`'s result has no such field: `known (#316)`. If #316 renames the docs to `tenantGuardrail`, this case is removed. |
| `tenant-missing-scope` | No `tenantScope` with a policy: `TenantScopeError` `MISSING_SCOPE`, and no model call. Runs once, as `[postgres]`. |
| `tenant-subtree-no-resolver` | `subtree` access with no resolver: `TenantScopeError` `SUBTREE_NOT_RESOLVABLE`, and no model call. Runs once, as `[postgres]`. |

The strict cases fail on the leak itself: when `ask()` returns SQL it should have rejected, the test runs that SQL and compares the rows with the scope's oracle before anything else. Their cells also hold a test that runs each reply raw, so a missing or broken cassette shows as `FAIL`. The `known (#316)` case fails because a result field is missing, not on a leak.

### Row-level security (informational)

`test/tenant-rls.test.ts` shows the database-side tenancy the docs recommend next to AskDB's check (`concepts/safety-boundaries.mdx`, "Enforce tenancy in the database"). It is **informational**: it tests Postgres and the lab's policies, not AskDB. The SQL is the unfiltered reply's cassette, and AskDB never sees it here.

It runs on the **lab's Postgres**, a lab-only server in [`compose.yml`](compose.yml) on port 15442 (`ASKDB_LAB_POSTGRES_PORT` overrides it), never on the shared fixture, whose tables it would change for everyone. `pnpm lab:up` starts it. The test's `beforeAll` seeds it with the fixture's own seeder (`src/lab-postgres.ts` runs `tsx src/seed.ts postgres` with `ASKDB_FIXTURE_POSTGRES_PORT` pointed at it) and then applies `src/lab-postgres.sql`: a read-only `lab_tenant` login, and on the tenant policy overlay's tables a policy that keeps `lab_tenant` to the agency in the setting `app.agency_id`. `fixture_reader` bypasses the policies. To start it alone, run `pnpm -C examples/consumer-lab postgres:up`; `postgres:down` stops it, and its data goes with it. Seeding in the test, not in `lab:up`, keeps a broken setup (a fixture DDL change the policies no longer fit) to this one cell, with the error as its reason, while the rest of the matrix runs. Like the fixture, it is one server shared by every checkout on the machine (project `askdb-consumer-lab`, whatever `COMPOSE_PROJECT_NAME` says), so `lab:down` and `lab:reset` stop it for everyone. To run a private one, start it under another project name and port (`ASKDB_LAB_POSTGRES_PORT=<port> docker compose -f examples/consumer-lab/compose.yml -p <name> up -d --wait`) and set the same port for the tests.

| Scenario | What it checks |
|---|---|
| `tenant-rls` | The `tenant-unfiltered` reply, run as `lab_tenant` with `app.agency_id` set to 2 for the transaction, returns exactly agency 2's programs from the oracle; run as `fixture_reader`, every agency's. Runs once, as `[postgres]`, and needs no AskDB install. |

Informational describes what the case proves, not how the matrix counts it: a `FAIL` here fails `lab:matrix` like any other cell. Nothing in AskDB can turn it red; a red cell means the lab's policies, the fixture's DDL or the lab's Postgres broke, and the change that broke it should fix it.

## Sensitive columns

`test/sensitive.test.ts` checks the sensitive-column contract ([`docs/contracts/sensitive-fields-and-modes.md`](../../docs/contracts/sensitive-fields-and-modes.md)) on the prompt the model receives and on the SQL that comes back. The design is "Sensitive columns" in [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).

- **The overlay.** `scenarios/overlay/sensitive-columns.json` lists `table:people.client#email` and `table:people.client#ssn`. `src/sensitive.ts` copies each dialect's introspected artifact into a fresh directory under `.lab/artifacts/sensitive/` and sets `sensitive: true` on those two columns in its `schema.json`, finding each by table and column name (SQLite's tables are under `public`). The introspected artifacts stay unmarked for the other suites.
- **The prompt.** Every prompt assertion reads the replay server's request log over HTTP, `GET /__lab/requests`, so it checks what the model received, not what AskDB says it sent. Each omission case also makes the same call without the switch, as its control: there the columns must be named and tagged, so an omission case can't pass because the table, or the overlay, is missing. An omitted prompt must still describe the rest of `people.client` (`full_name`, `birth_date`).
- **The catalog.** The suite's questions are `scenarios/sensitive-questions.json`, all with ids starting `sensitive-`, and their replies are `cassettes/<dialect>/sensitive-*.json`. The control reply reads only unmarked columns. The others read `email` or `ssn` in a different shape each: a bare column, an alias-qualified one, the dialect's quoted identifiers (`"c"."ssn"` on Postgres and SQLite, `` `c`.`ssn` `` on MySQL and MariaDB, `[c].[ssn]` on SQL Server), a `WHERE` filter only, `SELECT *`, and `c.*` on a join. The warn-mode cases also run each reply as the host and count the seeded emails and SSNs that come back, against the seed data: a reply that selects a column returns every seeded value of it, and the control and the filter-only reply return none.

| Scenario | What it checks |
|---|---|
| `sensitive-prompt-tagged` | The default prompt names `email` and `ssn`, every line that names them carries `(sensitive)`, and no other line does. |
| `sensitive-omit-library` | `ask()` with `omitSensitiveIdentifiersFromNlToSqlPrompt: true` sends neither column. |
| `sensitive-omit-client` | `createAskDb().ask()` with the `omitSensitiveIdentifiersFromNlToSqlPrompt` override sends neither column. Runs once, as `[postgres]`. |
| `sensitive-omit-cli` | `askdb ask --omit-sensitive-from-prompt` sends neither column. Runs once, as `[postgres]`. |
| `sensitive-omit-http` | `POST /ask` with `omitSensitiveFromPrompt: true` sends neither column. Runs once, as `[postgres]`. |
| `sensitive-omit-config` | With `modes.omitSensitiveFromPrompt: true` in `askdb.config.ts`, `askdb ask` sends neither column. `askdb-http` from that config still sends both when a request leaves the field out, although the HTTP reference gives the field that default: `known (#376)`. Runs once, as `[postgres]`. |
| `sensitive-omit-env` | `ASKDB_OMIT_SENSITIVE_FROM_PROMPT=true`, which the contract lists as a way to omit, is never read from the environment, by `askdb ask` or by `askdb-http`: `known (#377, #376)`. The HTTP case also needs `askdb-http` to honor the runtime setting at all (#376). Runs once, as `[postgres]`. |
| `sensitive-warn` | In the default warn mode, each named-column reply is returned unchanged with `sensitiveGuardrail` `{ passed: false }` and exactly the expected references (`qualified` or `unqualified`). With omission on, a reply that reads `ssn` is still flagged. The control passes with no references. |
| `sensitive-strict` | With `sensitiveGuardrailMode: "strict"`, each named-column reply reaches the model and is rejected with `SensitiveReferenceError` `SENSITIVE_COLUMN_REFERENCED` and the same references. The control is returned. |
| `sensitive-wildcard` | `SELECT *` (both columns, `unqualified`) and `c.*` on a join (both, `qualified`), in warn and strict mode as above. |

The `known` cases fail only because the prompt still names the sensitive columns: a failed request, not exactly one answered model call, or a prompt that lost `people.client` makes the body pass, so `it.fails` shows the cell as `FAIL` instead. The passing cases in the same suite start the same CLI and HTTP server from the same artifact.

## The matrix

`pnpm lab:matrix` runs `lab:up`, then the whole suite with `src/matrix-reporter.ts`, so it tests whatever `lab:use` last installed. `lab:up` keeps a verified install that is still current (this checkout at the same commit and uncommitted edits) or that you chose with `lab:use` (a published version, a git ref, another path), and says which. It installs this checkout when nothing is installed, when the installed checkout is stale, or when only the restored baseline is installed (after `lab:use --restore` or `lab:reset`, as on a fresh clone). So `pnpm lab:use npm:latest && pnpm lab:matrix` tests `npm:latest`, and `pnpm lab:use .` switches back. The reporter prints a `scenario × dialect` table and writes it to `.lab/matrix.json` (and to `$GITHUB_STEP_SUMMARY` when that is set). It builds every test row from test results, never from a hand-kept list:

- A test's full name starts with `[<dialect>] <scenario-id>`, usually as `describe("[mysql]")` around `it("introspect-golden: …")`. Tests that share a scenario and dialect share a cell.
- `pass`: every test in the cell passed. `FAIL`: one failed, or its suite's hook did.
- `known (#N)`: an `it.fails` test that names its `discrepancy` issue, for example `it.fails("… (#239)")`, failed as expected. Once the bug is fixed the test passes, `it.fails` turns that into a failure, and the cell shows `FAIL` until the marker is removed.
- `n/a (capability: …)`: a capability gate skipped the test because the install target lacks a documented capability (see [Capabilities](#capabilities-testing-older-targets)). Any other skip of a test that was meant to run is a `FAIL`: the lab fails rather than skips.
- `-`: no test ran for that dialect (none exists yet, or a `-t` filter excluded it; an excluded test never inherits a sibling's failure).

`lab:matrix` exits 1 when any cell is `FAIL`, including the two that vitest itself counts as passing (an `it.fails` test that names no issue, and a skip that isn't a capability gate). `pass`, `n/a` and `known` cells don't fail it. The failing cells are listed under the table.

`node examples/consumer-lab/src/matrix-cells.mjs [--status fail,known,na] [<matrix.json>]` lists the cells that aren't `pass`, one per line: each `FAIL` cell with the first line of each failure's reason, then one group per issue and per capability. It reads `.lab/matrix.json` unless given another file, such as CI's `consumer-lab-matrix` artifact.

Below the test rows, the `unique-constraints *` and `view-marker *` rows are **annotations, not test results**: facts the golden schema holds but the schema artifact can't express (the "Not comparable" rule in [`NORMALIZATION.md`](../../fixtures/multi-engine/dataset/NORMALIZATION.md)). The reporter prints them as `n/a (not in the schema artifact)` from a static list, and `matrix.json` keeps them under `annotations`.

### In CI

The `consumer-lab` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every pull request and every push to `main`. It runs `pnpm lab:use .` (tarballs packed from the commit under test), then `pnpm lab:matrix`, with a 25-minute timeout. `lab:matrix` runs `lab:up`, so the job also starts the lab's Postgres for `tenant-rls` (a few seconds, on the `postgres:17` image the fixture already pulled), and the test seeds it. The table goes to the job summary, followed by a collapsible block per failing test with the reason it failed (the assertion message, or the rule that made a passing test a failure) and any unhandled errors; the full stack traces are in the step log. `.lab/matrix.json` holds the same reasons (a `FAIL` cell's `failures`), and is uploaded as the `consumer-lab-matrix` artifact whether the job passes or fails. The job fails exactly when `lab:matrix` exits non-zero. Docs-only pull requests skip it: those whose every changed file is under `apps/docs-site/`, `docs/` or `plans/`, a top-level `*.md`, or a `README.md` or `CHANGELOG.md`. Other Markdown still runs the lab, because schema artifacts are Markdown too.

### Published packages

The **Consumer lab (published)** workflow ([`.github/workflows/consumer-lab-published.yml`](../../.github/workflows/consumer-lab-published.yml)) runs the lab against AskDB as published on npm, which the `consumer-lab` job can't see: files missing from a published tarball, a bad `workspace:` rewrite, a dist-tag on the wrong version, and dependency drift with no AskDB release (#255).

| Trigger | Target | Install |
|---|---|---|
| After a release that published: `workflow_run` on Release, when the run and its `publish` job succeeded | `npm:latest`, with the lab checked out at the released commit | The committed lockfile, so a failure is the release's. It first waits until every public package's `latest` dist-tag is the released commit's version, and fails if one isn't after 10 minutes. |
| Weekly, Mondays | `npm:latest`, from `main` | Fresh: the lockfile `lab:use` wrote is deleted and every range resolves anew, as `npm install askdb` does that day. The AskDB pins stay, and `lab:use --check` verifies them. So do the host's own exact pins (drivers, `ai`, `@ai-sdk/openai`, `zod`), which Dependabot moves: what drifts is what AskDB's packages and those pins resolve within their ranges. The job summary lists every package that resolved differently. |
| Manual (`workflow_dispatch`) | Any npm target: `npm:latest`, `npm:askdb@<version>` or `npm:<dist-tag>`, from the branch it runs on | The lockfile, or fresh with `fresh` ticked. |

On an `npm:latest` target, the job summary first says whether the committed baseline is stale (`lab:use` changed `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`) and which AskDB pins moved. Then `lab:matrix` runs, and `node examples/consumer-lab/src/published-run.mjs verdict` decides the job:

- A failure is expected only when [`known-release-failures.json`](known-release-failures.json) lists its cell for the installed `askdb` version, with the issue that tracks it: a release that shipped with a bug fixed on `main` since. A listed cell passes whatever fails in it, so an entry is for one release only. Any other `FAIL` cell, a failing test outside the matrix, an unhandled error, or a run that left no results fails the job. Entries are keyed by version, so one never hides a failure in the next release.
- After a release, a capability `n/a` cell fails the job as well. CI ran the lab on the released commit with `lab:use .`, where a missing capability fails, so the release should have every capability. When a changeset was still pending at that commit, the release may not include its change yet: the summary lists the cells and the changesets instead, to check with [baseline refresh](../../.agents/skills/consumer-lab/baseline-refresh.md) step 3.

The matrix table and "Why they failed" are in the job summary, as in CI. The `consumer-lab-matrix` artifact holds `matrix.json`, vitest's `vitest-results.json` and, for a fresh run, the lockfiles before and after.

## Introspection

`test/introspection.test.ts` introspects every fixture database with the installed `askdb introspect`, as the docs site describes for each engine: `--engine`, `--url` (the read-only role) and `--schemas org,people,billing,ref` for Postgres, SQL Server, MySQL and MariaDB (`--engine mysql`), and `introspection.providerConfig.sqlite.file` in an `askdb.config.ts` for SQLite. That config is written to a fresh directory under `.lab/projects/` for each run (concurrent runs never share one), so its `@askdb/config` import resolves from the lab's `node_modules`. Each artifact is compared with the fixture's golden schema, loaded with `loadSchema`, and bundled with `askdb bundle`. The drivers the CLI needs (`pg`, `mysql2`, `mssql`, `better-sqlite3`) are the lab's own dependencies, as the CLI reference asks of a consumer project.

## The `askdb` CLI

`test/surfaces/cli.test.ts` runs the installed `node_modules/.bin/askdb` the way a user runs it, against [`reference/cli.mdx`](../../apps/docs-site/src/content/docs/reference/cli.mdx). `askdb ask` reads the lab's `askdb.config.ts`, so its model is the replay server (the test sets `LAB_REPLAY_BASE_URL`), and its dialect comes from the engine the artifact records.

| Scenario | What it checks |
|---|---|
| `cli-ask-replay` | On every dialect, `askdb ask` prints each catalog question's cassette SQL on stdout and exits 0. |
| `cli-ask-mock-sql` | `--mock-sql` prints its SQL on stdout, exits 0 and sends the configured model nothing. |
| `cli-ask-sensitive-warning` | SQL reading a column the artifact marks `sensitive` gets a `Warning:` on stderr naming it, the SQL still on stdout, and exit 0; SQL that reads none gets no warning. |
| `cli-ask-exit-1` | Rejected SQL and a missing schema artifact exit 1, with the error on stderr and no SQL on stdout. |
| `cli-exit-2` | A missing `--question` and an unknown flag exit 2. Every argument error exits 1 today (#287), so these are `known (#287)`. |
| `cli-introspect-exit-1` | On every dialect, `askdb introspect` with a wrong password (or a missing SQLite file) exits 1 and writes no artifact. |
| `cli-introspect-output` | With no output flag, `askdb introspect` writes to `introspection.outputDir`; `--print` prints the schema and writes nothing. |

The engine-independent scenarios run once, as `[postgres]`.

## The HTTP API

`test/surfaces/http-api.test.ts` runs the installed `askdb-http` bin (`@askdb/http-api`, one of the lab's direct dependencies) the way `guides/deploy-as-http-service.mdx` does: `askdb-http --schema-path <artifact> --port <free port> --host 127.0.0.1`, from a project whose `askdb.config.ts` it reads. The model is the replay server, through the config's `providerConfig.openai.baseUrl`. Each server is ready once `GET /health` answers, and is killed when the suite ends (`src/http-api.ts`).

It covers the `POST /ask` success shape on every dialect, and on Postgres one case per documented error code and status, the `x-correlation-id` header, `GET /health`, and a tenant-policy schema, which fails closed over HTTP because a request has no scope field (#277). The suite's own catalog adds one question whose reply is a write statement, for `sql_validation_error`; a question with no reply drives `sql_generation_error`.

`test/surfaces/http-api-no-pg.test.ts` installs the deploy guide's packages (`@askdb/http-api @askdb/postgres ai @ai-sdk/openai`, pinned to the lab's target) into a fresh pnpm project in the system temp directory, checks that no `pg` is in its lockfile or resolvable from the AskDB packages, then starts that project's `askdb-http` and gets `/health`. It lives outside the lab because Node would otherwise resolve the lab's own `pg`.

## Studio

`test/surfaces/studio.test.ts` runs the installed `askdb studio --schema <artifact> --port <free port> --host 127.0.0.1` (`reference/cli.mdx`; `@askdb/studio` is one of the lab's direct dependencies, as that page asks), and drives it over HTTP the way Studio's own page, a DNS-rebound page and another site would. Its contract is [ADR 0009](../../docs/adrs/0009-studio-local-api-protection.md) and `studio.mdx` ("Security model", "Playground"). Each server runs in a fresh project under `.lab/` with a copy of the artifact and an `askdb.config.ts` whose `studio.execute` block (`enabled: true`, the engine's `provider`, and `databaseUrl` or `file` through `env()`) points at a [scratch copy](#scratch-databases) of the fixture, as the engine's **owner**. It is ready once its page answers, and is killed when the suite ends (`src/studio.ts`; `src/server-process.ts` starts and stops it, as it does `askdb-http`). The session token is read from the served page's `<meta name="askdb-studio-token">`, as the browser app reads it.

Each rejecting request is one header, or one statement, away from a request the same test shows is accepted, with every other guard satisfied, so the rejection can only come from the protection it targets.

| Scenario | What it checks |
|---|---|
| `studio-token` | The page carries a 64-hex session token, and another launch's page carries another. `/api/workspace` without `x-askdb-studio-token` answers `403` and with the page's token `200`; each launch's token answers `403` on the other launch. |
| `studio-host` | A rebound `Host` (`evil.example:<port>`) answers `403` on the page, which then holds no token, and on `/api/*` with a valid token; `127.0.0.1` and `localhost` on Studio's port answer `200`. `127.0.0.1` on another port answers `403`. |
| `studio-origin` | `POST /api/execute` from `Origin: http://evil.example`, with a valid token and JSON, answers `403`; from Studio's own origin, `200`. |
| `studio-content-type` | The same `POST /api/execute` as `text/plain` answers `415`; as `application/json`, `200`. |
| `studio-execute-select` | On every dialect, a `SELECT` returns the scratch copy's agencies, unicode names included. |
| `studio-execute-write` | On every dialect, a `DELETE` answers `400` and leaves the rows. Run raw as the owner on the same scratch copy, the same `DELETE` empties the table. |
| `studio-execute-multi-statement` | On every dialect, two `SELECT`s in one request answer `400` while either alone answers `200`, and `SELECT 1 AS ok; DELETE …` answers `400` and leaves the rows, though run raw as the owner it deletes them. |

The protection scenarios are engine-independent and run once, as `[postgres]`. The execute scenarios run on all five engines: Studio's execute supports Postgres, MySQL, SQLite and SQL Server, and MariaDB through the `mysql` provider. Every scenario needs the `studio-execute-guard` capability, because every Studio here has `studio.execute` on; the protection scenarios also need `studio-request-guard`. The routes are those in `docs/specs/studio.md`'s API table. No document gives `POST /api/execute`'s request `{ sql }` or its reply `{ ok, columns, rows }`: they are the served app's own (#380). Timeouts and row caps aren't tested.

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
3. It writes a pnpm `overrides` block into `pnpm-workspace.yaml` covering **every** target package, headed by a `# lab:use target:` comment. The block sits at the end of the file's `overrides:` map, below the lab's hand-written third-party pins, which it leaves alone. Without it, a transitive `@askdb/*` dependency would resolve from npm under the same version number, so the lab would quietly test the published code instead of the checkout, or another release than the one asked for.
4. It installs, then reads the lockfile and prints each `@askdb/*` package's version and source. It fails if any package isn't from the target's source (tarball, or registry), isn't at the target's version, or wasn't pinned by the target at all. `pnpm lab:use --check` repeats this check on the current install.

`lab:use` rewrites `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. The committed versions are the **`npm:latest` baseline** (decision 2 in the spec): `latest` is what `npm install askdb` resolves, so it's what users run. `pnpm lab:use --restore` brings them back: it removes `.lab/` and `node_modules`, reinstalls the committed lockfile as-is and verifies it against the pins in the committed overrides block.

- **Don't commit the three files after `.`, a path or `git:`**: they hold `file:` tarball paths. Don't commit them after another npm target either.
- **To refresh the baseline** after a release ships, run `pnpm lab:use npm:latest` and commit the three files.
- There is no `beta` dist-tag: it was removed from every package on 2026-09-29 (#267), so `pnpm lab:use npm:beta` stops with `no AskDB package is published under the "beta" dist-tag`. Prereleases are on `latest` until the RC line (#354) publishes under `rc`.
- The lab's typecheck (`pnpm -C examples/consumer-lab lint`) is against the installed target too, so run it after `pnpm lab:use .`.

The lab doesn't inherit the monorepo's `minimumReleaseAge` (it is its own pnpm root), but pnpm 11 defaults it to one day, so the lab's `pnpm-workspace.yaml` sets `minimumReleaseAgeExclude: [askdb, "@askdb/*"]`. Without it, a release published less than a day earlier still installs, because the lab pins it exactly, but pnpm adds each `@askdb/*` version to `minimumReleaseAgeExclude` itself and rewrites the file. The rewrite indents the `# lab:use` comments, so `lab:use --restore` no longer finds the committed target (seen refreshing the baseline to `askdb@1.0.0-beta.43` 21 minutes after it was published). Third-party packages keep the one-day delay.

The baseline pins the lab's third-party dependencies exactly, so they stay the same across install targets: the drivers (`pg`, `mysql2`, `mssql`, `better-sqlite3`), `zod`, `ai` and `@ai-sdk/openai`. The AskDB adapters declare `ai` as a peer and `@askdb/rag` declares `@ai-sdk/openai` as an optional one, so the host pins both, by hand, at AskDB's published floors (ADR 0015). Dependabot updates the lab's other pins, with its lockfile, through the lab's own entry in `.github/dependabot.yml`, which ignores these two, the AskDB packages and `@types/node` majors (it tracks the Node floor, `engines.node`); an advisory against a floor pin still shows up as a Dependabot alert on the lab's lockfile. A change that raises a floor on purpose raises the pin with it, or `host-peers` (`test/host-peers.test.ts`) fails:

| Scenario | What it checks |
|---|---|
| `host-peers` | `pnpm peers check` finds no peer range declared by an installed AskDB package that the host's pins don't meet, and every installed AskDB package declares the same `ai` range for the host's AI SDK major, as a dependency or a peer, so a runtime `ai` floor can't rise alone. `@askdb/core` and `@askdb/rag` also accept AI SDK 6 (`^6.0.0 || ^7.0.51`); only their 7.x part is compared. It doesn't notice a pin that rises above a floor. Runs once, as `[postgres]`. |

A vulnerable transitive dependency that no parent release fixes yet gets an `overrides` entry above the `lab:use` block, with its advisory and removal condition in a comment, mirroring the monorepo's `pnpm-workspace.yaml`. Today that is `deepmerge-ts` (GHSA-ggr8-5vv4-36mx), which `@prisma/config` pins at 7.1.5.

`askdb` depends on `@askdb/prisma`, whose `@prisma/engines` has a postinstall script that pnpm 11 won't run until it's approved. The lab approves it in `pnpm-workspace.yaml`, as a pnpm user would have to (#259). It approves the `better-sqlite3` build the same way.

## Capabilities: testing older targets

A scenario may need a documented capability that an older target lacks. It declares that by calling `needsCapability(ctx, "<capability>")` from `src/capabilities.ts` first. When the installed target lacks the capability, the test is skipped with the note `capability: <capability>`, which the suite's verbose reporter prints and `lab:matrix` shows as `n/a (capability: <capability>)`.

Capabilities are detected from the installed target's public surface: an export, documented `--help` output, the published package manifest, or the documented behavior itself (a probe that runs the documented command). They are never detected from version strings. Only a surface that works but lacks the capability counts as absent. A missing `askdb` bin, a crash, or a non-zero exit from `--help` is a broken install, and the test fails. When the target is this checkout (`lab:use .`), a missing capability fails the test instead: the lab is written against this checkout's docs, so there it's a regression.

| Capability | Detected by | Used by |
|---|---|---|
| `cli-introspect-engine` | `askdb introspect --help` documents `--engine` (`reference/cli.mdx`), when run with the lab's config | every scenario that builds a schema artifact (`test/lab-ask.test.ts`, `test/surfaces/cli.test.ts`) |
| `mysql-databases` | `askdb introspect --schemas org,people,billing,ref` on the fixture's MySQL returns a table from a database other than the connection's (`reference/cli.mdx`, `guides/switch-engines.mdx`) | MySQL and MariaDB `introspect-golden` / `introspect-loads` (`test/introspection.test.ts`), every MySQL and MariaDB tenant scenario, whose policy scopes tables in all four databases (`test/tenant.test.ts`), and every MySQL and MariaDB sensitive-column scenario, whose overlay marks columns in the `people` database (`test/sensitive.test.ts`) |
| `http-api-optional-drivers` | the installed `@askdb/http-api`'s published manifest lists no database driver as a dependency, since the docs call drivers optional peers (`guides/switch-engines.mdx`, `reference/packages.mdx`; #260) | `http-no-pg` (`test/surfaces/http-api-no-pg.test.ts`) |
| `subtree-resolver` | `ask()` with `subtree` access and a recording `resolveTenantDescendants` calls it with the scope's root and seed (`guides/multi-tenancy.mdx`, "Hierarchical scope (`subtree`)"). Releases before #232 was fixed (#270) never call it. The probe doesn't check what `ask()` does with the answer, so a target that drops it fails `tenant-subtree` instead of reporting `n/a` | `tenant-subtree`, `tenant-subtree-seeds`, `tenant-subtree-no-resolver` (`test/tenant.test.ts`) |
| `tenant-driver-markers` | `ask()` in `tenantSqlMode: "sql-params"` on SQLite returns `?` markers for the tenant IDs (`reference/core-api.mdx`, `tenantSqlMode`). Releases before the fix for #231 used Postgres `$N` markers on every dialect | the `sql-params` cases of `tenant-ids`, `tenant-subtree` and `tenant-subtree-seeds` (`test/tenant.test.ts`), except on Postgres, whose markers were always `$N`: there only the question with a business parameter needs it, because before #231 was fixed its tenant markers in `sql` were numbered after the business values |
| `tenant-predicate-required` | strict `ask()` rejects a reply that filters on a literal agency instead of `:tenant_agency_ids` (`docs/contracts/tenant-policy.md`, "Guardrail validation"). Releases before the fix for #315 accepted any mention of the tenant column | the strict-mode rejection cases of `tenant-strict-column-only`, `-wrong-tenant`, `-or-true` and `-root-table` (`test/tenant.test.ts`) |
| `studio-request-guard` | the page the installed `askdb studio` serves carries `<meta name="askdb-studio-token">` (ADR 0009; `studio.mdx`, "Security model"). Releases before PR #185 check nothing but the socket address | the protection scenarios in `test/surfaces/studio.test.ts` (`studio-token`, `studio-host`, `studio-origin`, `studio-content-type`) |
| `studio-execute-guard` | with no `studio` block in its config, the installed Studio answers a `POST /api/execute` that passes every request guard with a `403` that explains how to enable execute (`studio.mdx`, "Playground": execute is off by default). Releases before PR #194 always execute, without the read-only SELECT check | every scenario in `test/surfaces/studio.test.ts` |
| `sensitive-wildcards` | `ask()` on the Postgres artifact with the sensitive overlay, with `SELECT * FROM people.client` as the reply through `deps.generateText`, reports `ssn` in `sensitiveGuardrail.references` (`reference/core-api.mdx`, `SensitiveReference`: a bare `SELECT *` "reaches every sensitive column"). Releases before the expansion report no reference for `SELECT *` or `alias.*`. The probe doesn't check `alias.*` or the `matchKind`, so a target that expands them wrongly fails `sensitive-wildcard` instead of reporting `n/a` | `sensitive-wildcard` (`test/sensitive.test.ts`) |

Both Studio capabilities come from one launch of the installed Studio, shared by the suite's run.

To add one, add a detector to `DETECTORS` in `src/capabilities.ts`, citing the docs page that documents the capability. A detector that has to run `ask()` or start a server is async: it goes in `ASYNC_DETECTORS`, and a scenario awaits `needsCapability` for it.
