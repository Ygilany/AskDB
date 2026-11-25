---
name: verify-askdb
description: "Launch and drive AskDB the way a user does: the `askdb` CLI, the HTTP API and Studio, built from this checkout, in a disposable project with a fake or live model, capturing evidence; and run or extend the scripted replays (`pnpm e2e`). Use to run, start or screenshot AskDB, to prove a user-facing change works in the real app (not just tests), to reproduce a reported CLI, API or Studio behavior, or when a replay in `e2e/` fails."
---

# Verify AskDB

AskDB's user surfaces are the `askdb` CLI (`apps/cli`), the HTTP API (`apps/http-api`) and Studio (`apps/studio`, a browser UI). The library itself (`ask()` in `@askdb/core`) has no surface of its own: drive it through these, or through the [consumer lab](../consumer-lab/SKILL.md), which installs AskDB the way an outside project does and runs a matrix over four engines.

Verification is a hybrid:

- **Scripted replays** in the private package [`e2e/`](../../../e2e/) run the journeys the feature map marks `scripted`, with no model involved: Vitest for the CLI and API, Playwright for Studio. CI runs them on every PR that isn't docs-only. Locally you run them with `pnpm e2e`.
- **Agent-driven verification** is this skill: you drive what a change touches, what a replay flagged, and every sub-feature marked `agent`, through the same harness.
- **Promotion:** when you have proven a journey and its UI has stopped changing, write its replay in `e2e/` in the same PR and mark it `scripted`.

Both halves share one harness, [`e2e/harness/askdb-run.mjs`](../../../e2e/harness/askdb-run.mjs), so a replay and an agent drive start from the same state. Each run gets its own project folder, outside the repo:

- **Config:** an `askdb.config.ts` pointing at the run's own ports.
- **Database:** the Quickstart's `shop.db` (`examples/quickstart-shop/shop.sql`).
- **Schemas:** copies of `fixtures/schemas/{orders-users-sensitive,agency-multi-tenant}.schema`.
- **Model:** a fake OpenAI endpoint (`e2e/harness/fake-openai.mjs`) that answers with the SQL you set and records every prompt.

Two runs never share a port, project or model, so runs from other worktrees are safe beside yours. Run every command from the repo root. Below, `vctl` stands for `node e2e/harness/control-askdb.mjs`.

## The loop for a change

1. **Replays first:** run `pnpm e2e`. It builds what the replays drive, then runs them all, in seconds. The first time, install Playwright's browser: `pnpm -C e2e exec playwright install chromium`.
2. **Triage each failing replay** before anything else. Rerun the failing journey through `vctl` with the steps of its feature file. If AskDB behaves as the feature file says and only the replay is wrong (a renamed control, a changed message the change intended), fix the replay and the feature file. If AskDB is wrong, it's a bug: report it or fix the product.
3. **Drive what the change touches:** every feature whose code the diff changes, and every sub-feature marked `agent`, with the steps below.
4. **Promote:** write a replay for each journey you proved that has stopped changing, and mark its sub-feature `scripted`. A new user-facing feature gets a feature file first.

Done when `pnpm e2e` passes and every touched feature has evidence from step 3.

## Launch

```bash
pnpm exec turbo run build --filter=@askdb/e2e^...   # builds the CLI, HTTP API and Studio, and what they need; pnpm e2e does it too
vctl setup            # or: vctl setup --live   (real OpenAI: OPENAI_API_KEY in env or the repo's .env)
```

`setup` refuses to start if a build is missing. It is ready when it prints `run <id> ready`, and every later `vctl` command from this checkout uses that run (pass `--run <id>` to pick another). The CLI is short-lived: each `vctl cli` call is one fresh process in the project. The two servers are long-lived, each on the run's own port:

```bash
vctl api start [schema-dir]      # ready: "AskDB HTTP API listening on"; default schema: schemas/orders-users-sensitive.schema
vctl studio start [schema-dir]   # ready: "AskDB Studio is running at"; same default
vctl studio start --no-schema    # no --schema: Studio opens ./askdb, or its setup wizard when that doesn't exist
vctl api stop / vctl studio stop
```

Studio writes into its schema folder (`tables/*.md`, `concepts.md`, `playground-history.json`), which is why the run uses copies. Never point a drive at `fixtures/` or the repo root's config.

## Doctor

```bash
vctl doctor
```

Read-only. Exits 1 on any `FAIL`. It checks:

- the CLI's `--version` matches `apps/cli/package.json`;
- every `dist` is newer than its `src` (`FAIL dist current` means rebuild);
- the project exists;
- the fake model answers for this run, and each server the run started is still the process it started and answers on its port.

Run it before the first drive, after any drive that surprised you, and before you report a failure. When the doctor passes but Studio's UI looks wedged, `vctl studio stop` and start it again instead of driving on.

## Drive

```bash
vctl model reply "SELECT name FROM customers"        # what the fake model answers from now on; bare SQL is fenced for you
vctl model reply --raw "<text or JSON>"              # unfenced: Studio's suggestions (candidates split on --- lines) and tenant-policy draft (JSON)
vctl cli --label <name> -- <askdb args>              # e.g. -- ask --question "…"; prints stdout/stderr, exits with askdb's code
vctl model requests --label <name>                   # saves the prompts the model received
vctl api-request <METHOD> <path> ['<json>']          # the HTTP API
vctl studio-request <METHOD> <path> ['<json>']       # Studio's API, with its session token, Origin and JSON type
```

The feature map in [`features/`](features/README.md) is the source of truth for what to drive: start at its README, then use the feature's file as the recipe. A proof covers every entry point the feature file lists, not just the convenient one.

For Studio's UI, use whichever browser tool the session has (the T3 preview tools, Claude in Chrome, the in-app browser) on `http://127.0.0.1:<studio port>` (`vctl studio start` prints it). Target handles by role and accessible name, as the feature files list them. Studio's page carries its API token, so the UI needs no setup.

## Write a replay

A replay asserts the steps of one feature file, one test per sub-feature, named by its ID (`ask-generate: …`). `pnpm e2e` starts with `node e2e/harness/check-feature-map.mjs`, which fails with one line per mismatch between the map and the replays' test names; the naming rule is in the [feature entry contract](features/README.md). It lives in `e2e/cli/`, `e2e/api/` or `e2e/studio/` and drives AskDB only through `AskdbRun` (`e2e/run.ts`): `AskdbRun.create()` or `introspectedRun()` in `beforeAll`, `run.cleanup()` in `afterAll`.

- **CLI, HTTP API and Studio's API:** Vitest, `*.test.ts`. `run.cli([...])`, `run.request("api" | "studio", …)`, `run.modelReply(…)`, `run.modelRequests()`.
- **Studio's UI:** Playwright, `e2e/studio/*.spec.ts`, using the `run` and `studioUrl` fixtures from `e2e/studio/fixtures.ts`. Find elements by role and accessible name only (`getByRole`), never by CSS selector.
- **The model:** replays always use the fake model, so their results don't change between runs.
- **The header:** answer the [test-audit](../test-audit/SKILL.md) gate: what it protects, what breaks it, and why it needs no production seam.
- **Prove it can fail:** break the behavior on purpose (rename the control, change the output), run `pnpm e2e`, see the replay fail for that reason, then revert.

## Evidence

Each `cli`, `model requests`, `api-request` and `studio-request`, from `vctl` or from a replay, writes one numbered file to the run's evidence folder: `<os tmpdir>/askdb-verify/<run>/evidence/NN-<label>.json`, or `NN-<label>.jsonl` for `model requests`, one request per line. Set `ASKDB_VERIFY_ROOT` to move the root; CI sets it and uploads the folder with Playwright's report as the `e2e-evidence` artifact. A CLI record holds the command, cwd, exit code, stdout and stderr. An HTTP record holds the request, status and response. A model-requests record holds each request's time, path and body. Save browser screenshots and accessibility snapshots into the same folder.

Proof standards:

- **The real path:** drive what a user runs. `--mock-sql` and `dev.mockSql` skip prompt building and the provider, so they prove only validation. Prove generation through the fake model, and use `--mock-sql` only where the feature file says it is the path under test.
- **Action and result:** capture the command and its outcome, and a second view of any state it changed: the files `introspect` wrote, the rows `execute` returned, the prompt the model received.
- **The model is a stand-in:** the fake model returns the SQL you set, so a fake-model run proves AskDB's handling of a reply, never the quality of a real model's SQL. Say which model you used. Use `--live` only when a real model's behavior is the question, and name the model.
- **Skips stay skips:** report an entry point you couldn't reach with the command you tried and the precondition that was missing. Never count it as verified through another path.

## Cleanup

```bash
vctl cleanup
```

Stops only the processes this run started: each is matched by PID and command line, never by name. It then deletes the run's project and copies the server logs and model prompts into the evidence folder as `zz-*`. The evidence folder stays: check it still lists your files before you report. Run cleanup after every failed attempt too, so nothing outlives the run. Replays clean up their own runs.

## Helpers

| File | What it is |
|---|---|
| `e2e/harness/askdb-run.mjs` | The harness: `AskdbRun` creates a run, drives it and cleans it up. Replays and `vctl` both use it. |
| `e2e/harness/control-askdb.mjs` | `vctl`, the agent's command line over `AskdbRun`. `vctl help` lists its commands. |
| `e2e/harness/fake-openai.mjs` | The stand-in model: OpenAI Responses and Chat Completions, replying with `<run>/model-reply.txt` and logging to `<run>/model-requests.jsonl`. The harness starts it; run it by hand (`node e2e/harness/fake-openai.mjs <run-dir> <port>`) only to debug it. |

Verification scaffolding: `setup` symlinks `@askdb/config` and `better-sqlite3` from `e2e/node_modules` into the project's `node_modules`, standing in for what an installed project resolves. `cleanup` deletes it with the project.

Keep the map and the replays current as you change AskDB: the feature entry contract in [`features/README.md`](features/README.md) and *Write a replay* above say how. A full pass over every feature, from source and live, is the maintainer's `maintain-verification-skill` (from the `Ygilany/skills` repository), when it's installed.
