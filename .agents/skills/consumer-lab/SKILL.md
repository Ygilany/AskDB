---
name: consumer-lab
description: "Drive AskDB's consumer lab (examples/consumer-lab) as a black-box test of installed AskDB. Use when choosing a `lab:use` target, running or triaging `lab:matrix` (locally or CI's `consumer-lab` job), after an AskDB release ships (baseline refresh), or adding a lab scenario."
---

# Consumer lab

The lab installs AskDB the way an outside project does and runs it on the shared multi-engine fixture. The [lab README](../../../examples/consumer-lab/README.md) is the source of truth for every command, cell value and convention; this skill is the order to do things in and the judgement calls. Run everything from the repo root.

After an AskDB release ships, follow [baseline-refresh.md](baseline-refresh.md): it refreshes the committed baseline and checks which capability cells the release flipped, using the guardrails and the triage below.

## Shared fixture guardrails

The fixture's containers are shared with other lab runs and agents, so every branch of this skill obeys these:

- Leave the shared fixture running. `pnpm fixture:down`, `fixture:reset`, `lab:down` and `lab:reset` stop or wipe it for everyone, so run them only on a fixture you started yourself. To try them, or to get a fixture you own, start a [second copy](../../../fixtures/multi-engine/README.md#running-a-second-copy) from another worktree with `COMPOSE_PROJECT_NAME` and the `ASKDB_FIXTURE_<ENGINE>_PORT` variables, and set the same variables on every command that should reach it.
- Treat the fixture's databases as read-only. Query them as the read-only `fixture_reader` role, as the lab's host path does, and put anything that writes on a scratch copy of your own (`lab_scratch_<token>`, from `src/scratch.ts`), as the safety suite does. The one write the lab makes is the seed in `fixture:up` (run by `lab:up` and `lab:matrix`): a no-op when the stored dataset hash matches the checkout's, but a reseed for everyone when it doesn't. From a branch that changes the fixture's dataset or seeder (`fixtures/multi-engine/`), use a second copy.
- End on the committed baseline: before committing anything, run `pnpm lab:use --restore`, unless the commit is a [baseline refresh](baseline-refresh.md). `git status examples/consumer-lab` must then show no change to `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`. `--restore` deletes `.lab/`, `matrix.json` included, so copy out a matrix you still need first. When the three files already show no change (after `lab:use npm:latest` while the baseline is current), there is nothing to restore.

Optional, only when `docker` fails with a credential-helper error (for example `error getting credentials` from `docker-credential-desktop` in a non-interactive shell): point Docker at an empty config and name the socket, `mkdir -p /tmp/lab-docker-config && echo '{}' > /tmp/lab-docker-config/config.json`, then prefix the fixture commands with `DOCKER_CONFIG=/tmp/lab-docker-config DOCKER_HOST=unix://$HOME/.docker/run/docker.sock`.

## 1. Choose the target

| You want to know | Target | Notes |
|---|---|---|
| Whether your change works | `pnpm lab:use .` | Packs this checkout, uncommitted edits included. The only target where a missing capability is a `FAIL`, not `n/a`. CI's `consumer-lab` job runs this. |
| What a PR, branch or commit does, or how it differs from yours | `pnpm lab:use git:<ref>` (`git:origin/main`, `git:origin/<branch>`, a sha) | `git fetch origin` first. Packs `<ref>` in a temporary worktree. A second checkout works too: `pnpm lab:use ../other-checkout`. |
| What users get from `npm install askdb` | `pnpm lab:use npm:latest` | The committed baseline's target. Use it after a release, and to check a report against what is published. |
| Which release broke something | `pnpm lab:use npm:askdb@<version>` | One release and the exact `@askdb/*` versions it depends on. Bisect over `npm view askdb versions --json`: run the failing scenario (`pnpm lab:matrix -t <scenario-id>`) on each candidate. |

`npm:beta` still installs, but the `beta` dist-tags are stale (#267) and `lab:test` fails against it; use `npm:latest` or a version. `lab:use` prints each `@askdb/*` package's version and source and fails if any doesn't match the target; `pnpm lab:use --check` re-verifies the current install. Details: [Install targets](../../../examples/consumer-lab/README.md#install-targets).

Done when `lab:use` has printed `lab:use: all N @askdb packages resolve to …` for the target you meant.

## 2. Run the matrix

```bash
pnpm lab:use <target>
pnpm lab:matrix                        # the whole suite; -t '<scenario-id>' or -t '\[mysql\]' narrows it
node examples/consumer-lab/src/matrix-cells.mjs   # every cell that isn't pass: FAIL, then by issue and by capability
```

`lab:matrix` runs `lab:up`, which keeps the target `lab:use` chose, and says so. It installs this checkout instead when nothing is installed or only the restored baseline is (after `--restore`), so run `lab:use npm:latest` right before `lab:matrix`, not `--restore`. The run takes several minutes; the table is printed at the end and written to `examples/consumer-lab/.lab/matrix.json`. For a CI run, read the same file from its artifact: `gh run download <run-id> -n consumer-lab-matrix -D /tmp/lab-ci`, then `node examples/consumer-lab/src/matrix-cells.mjs /tmp/lab-ci/matrix.json` (`--status fail,known,na` picks groups). The script lists a cell that names two capabilities or issues under each, so group counts can add up to more than its `N cell(s) listed` total.

## 3. Read the matrix

Cell values ([the matrix](../../../examples/consumer-lab/README.md#the-matrix) defines them):

| Cell | Meaning | What you do |
|---|---|---|
| `pass` | Every test in the cell passed. | Nothing. |
| `FAIL` | A test failed, its suite's hook failed, an `it.fails` names no issue, or a skip isn't a capability gate. `matrix.json` holds each failure's reason (`failures`); CI's job summary shows it under "Why they failed". | Triage it (below). `lab:matrix` exits 1. |
| `known (#N)` | An `it.fails` test naming its `discrepancy` issue failed as expected: the bug is still there. | Check `gh issue view <N> --json state`. Open: expected. Closed: the fix hasn't reached this target, or didn't work; see [findings](#4-known-failures-and-findings). |
| `n/a (capability: <name>)` | The target lacks a documented capability the test needs ([Capabilities](../../../examples/consumer-lab/README.md#capabilities-testing-older-targets)). Never on `lab:use .`, where a missing capability is a `FAIL`. | Check the change that brings it hasn't shipped in this target ([baseline refresh](baseline-refresh.md), step 3). Not shipped: expected. Shipped: a finding. |
| `-` | No test ran for that dialect: none exists, or `-t` excluded it. | Nothing. |

Rows marked `*` (`unique-constraints *`, `view-marker *`) are annotations, not results. `lab:matrix` exiting 1 with no `FAIL` cell means vitest failed outside the matrix: a test listed under "Not in the matrix" (the lab's own tooling tests), or an unhandled error (`unhandledErrors` in `matrix.json`). Find it in vitest's output above the table.

Triage every `FAIL` cell into one of these before reporting it; the reason text decides:

- **Broken install:** `The lab isn't installed yet`, `askdb … is missing; reinstall the lab`, `askdb … --help failed`, or a module that can't be resolved. Rerun `pnpm lab:use <target>`, and `pnpm lab:use --check`. A lab problem, until a clean install of the target still fails the same way.
- **Missing fixture:** a connection error (`ECONNREFUSED`, login failed, unknown database) or `not run: its suite … failed`, usually every cell of one engine at once. Check `docker ps` shows the four `askdb-fixture-*` containers healthy, and that the ports match the copy you meant. A lab problem.
- **Missing cassette or oracle:** a reason starting `lab replay: no reply …` names the cassette file to add; a question with no oracle fails in `results`. A lab problem in the scenario's authoring.
- **Fixed on `main` but not released:** on an npm target, a cell that fails on the release and passes on `main`. For the `main` side, read the matrix of the latest `main` CI run (`gh run list --branch main --workflow ci.yml`, then download its artifact as above), or run `git:origin/main` in another worktree. Find the fix with `git log origin/main` on the file of the failing test or on what it exercises, and confirm it hasn't shipped with [baseline refresh](baseline-refresh.md) step 3. Expected until the fix ships; report it as that, naming the fix.
- **Product regression:** anything else, a documented behavior the installed AskDB doesn't have. Confirm it on a clean install of the same target, then file or reuse an issue ([findings](#4-known-failures-and-findings)).

Done when every cell that `matrix-cells.mjs` lists has a verdict: each `FAIL` one of the five above, each `known` and `n/a` group expected or a finding.

## 4. Known failures and findings

- **A `known (#N)` cell turned `FAIL`** because #N was fixed: its `it.fails` test now passes, which `it.fails` reports as a failure. Change `it.fails` back to `it`, drop the `(#N)` from its name, and confirm the cell is `pass` on every dialect with `pnpm lab:matrix -t '<scenario-id>'`. The change belongs with the fix, on `lab:use .`; on an npm target the cell then reads `FAIL` until the fix is released, which the triage below calls "fixed on `main` but not released".
- **A new `FAIL` where the docs and AskDB disagree:** file a `discrepancy` issue as [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md) says: quote both sides with file paths, state the observed behavior per dialect, and name the decision needed. Then mark the test `it.fails("… (#N)")` so its cell reads `known (#N)`. The test keeps asserting the documented behavior; the lab never bends a test to match the code.
- **Every issue and PR you open** ends with the `Thread ID:` line AGENTS.md asks for; its value is the session's T3 worktree name (`t3code-…`).

Done when every `FAIL` cell you judged a product problem has an issue, and every `it.fails` you added or removed names the right one.

## 5. Add a scenario

Read the README section for the suite you're extending first. Then:

- [ ] Answer the [test-audit](../test-audit/SKILL.md) authoring gate in the test file's header: the contract, the regression it catches, why existing coverage misses it, and that it needs no production seam.
- [ ] Name it `[<dialect>] <scenario-id>`, usually `describe("[mysql]")` around `it("<scenario-id>: …")`, so `lab:matrix` places it. A scenario that doesn't depend on the engine runs once, as `[postgres]`.
- [ ] Drive AskDB only through documented surfaces (the docs site, `docs/contracts`, `docs/specs`, ADRs), and cite the page it tests.
- [ ] Take expected rows from an oracle computed from the seed data, never from SQL ([why](../../../examples/consumer-lab/README.md#why-the-expected-answer-never-comes-from-sql)). A catalog question needs a cassette per dialect and an oracle ([catalog](../../../examples/consumer-lab/README.md#the-question-catalog-and-its-replies)).
- [ ] If an older release lacks what it tests, gate it with `needsCapability(ctx, "<capability>")` and add a detector to `src/capabilities.ts` that probes the public surface, never a version string. A detector that runs `ask()` goes in `ASYNC_DETECTORS`, and the test awaits `needsCapability`. Add the capability to the README's table.
- [ ] Prove it: break the behavior on purpose (a wrong cassette, a wrong oracle value, or the product change reverted), show the command and the failing cell, then revert and show it pass. Put the proof in the PR.
- [ ] Add the scenario to its suite's table in the README.
- [ ] Typecheck against this checkout: `pnpm lab:use .`, then `pnpm -C examples/consumer-lab lint`.

Done when every box is ticked, and `pnpm lab:matrix -t '<scenario-id>'` on `lab:use .` shows the new cells `pass` (or `known (#N)`) on every dialect they run on.
