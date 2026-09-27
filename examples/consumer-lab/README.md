# AskDB consumer lab

A black-box test bed for AskDB. The lab installs AskDB the way an outside project would: from tarballs packed from a checkout, or later from npm (#244). It drives AskDB only through documented surfaces, and it acts as the host, executing the returned SQL on the shared [multi-engine fixture](../../fixtures/multi-engine/README.md).

- Design: [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).
- Work tracked in: #241.

This directory is **not** a member of the AskDB pnpm workspace. It is its own pnpm root with its own lockfile, so it never resolves `workspace:` links.

## Commands

From the repo root:

```bash
pnpm lab:up                    # start and seed the fixture; install the lab if it never was
pnpm lab:use .                 # pack this checkout's publishable packages and install them
pnpm lab:use ../other-checkout # …or another checkout's
pnpm lab ask --db mysql "How many active programs does each agency run?"
pnpm lab ask --db sqlserver --via client "Which three agencies have the highest paid order total?"
pnpm lab ask --db postgres --sql "SELECT agency_id, name FROM org.agency"
pnpm lab:test                  # the lab's own suite (needs the fixture and an installed lab)
pnpm lab:use --restore         # put the committed baseline back
```

`--db` is any fixture engine: `postgres`, `mysql`, `mariadb`, `sqlserver` or `sqlite`.

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

## How `lab:use` pins the target

1. It packs every publishable package with `scripts/pack-tarballs.sh`, the same step `pnpm smoke:install` uses, into `.lab/tarballs/`.
2. It points the lab's direct AskDB dependencies (`@askdb/core`, `@askdb/client`, `@askdb/ai-openai`, `@askdb/config`, `askdb`) at those tarballs.
3. It writes a pnpm `overrides` block into `pnpm-workspace.yaml` covering **every** packed package. Without it, a transitive `@askdb/*` dependency would resolve from npm under the same version number, so the lab would quietly test the published code instead of the checkout.
4. It installs, then reads the lockfile and prints where each `@askdb/*` package resolved from. It fails if any resolved from anywhere but the target's tarballs.

`lab:use` rewrites `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. **Don't commit them in that state.** The committed versions are the baseline, and `pnpm lab:use --restore` brings them back.

The baseline pins the lab's third-party dependencies exactly: the drivers (`pg`, `mysql2`, `mssql`, `better-sqlite3`), and `ai`, `@ai-sdk/openai` and `zod` at the versions the workspace uses. The AskDB adapters declare `ai` as a peer, so the host pins it.

`askdb` depends on `@askdb/prisma`, whose `@prisma/engines` has a postinstall script that pnpm 11 won't run until it's approved. The lab approves it in `pnpm-workspace.yaml`, as a pnpm user would have to (#259). It approves the `better-sqlite3` build the same way.
