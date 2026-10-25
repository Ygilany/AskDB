# Spec: make `lab-ui-isolation` pass on a loaded CI runner (#528)

## For the owner

This spec makes the five `lab-ui-isolation` cells pass in the `consumer-lab` CI job again by raising the isolation test's `TIMEOUT_MS` from 8 s to 30 s, test-only, with every assertion kept and `lab ui` unchanged.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. How to make the isolation run independent of runner speed | **A**: raise `TIMEOUT_MS` in the lab UI test from 8 s to 30 s, keep every assertion, add a comment that the value must exceed worker boot under CI load; `lab ui` and the README stay as they are | @Ygilany through their delegate, grilling (2026-10-25), decision 1 | Two-way: revert the PR |
| 1a. When the fix counts as proven | Only when the `consumer-lab` check passes on the PR; if healthy engines still time out there, build escalates with the CI log instead of raising `TIMEOUT_MS` again | @Ygilany through their delegate, grilling (2026-10-25), decision 1's condition | Two-way |

```text
lab ui --timeout T   (per engine, timer starts at fork)
  fork worker ──▶ boot (tsx transpile, import AskDB + drivers) ──▶ ask + execute ──▶ done
  │◀──────────────────────────── must finish within T ───────────────────────────▶│
  T = 8 s:  five boots at once on a loaded runner overrun T → healthy engines "timeout"
  T = 30 s: [changed] boot + run fits; only the never-answering Postgres reaches T
```

**Risks:** a runner slow enough to overrun 30 s would fail again; the owner's condition sends that back as an escalation, not another bump. The isolation run now waits 30 s for Postgres's timeout, so the job takes about 22 s longer.

**Done when:** the five `lab-ui-isolation` cells and `lab-ui-shutdown` pass in the PR's `consumer-lab` check, with every assertion unchanged in text; no change outside the lab UI test; no changeset.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The `consumer-lab` check is required on every AskDB PR, and it fails on `main` (run 40195533874 on `2ff9332`, and on `b281778`; it passed on `8fd3575`). All five failures are in the lab UI test's isolation scenario: Postgres's column isn't last, MySQL reports `timeout` instead of `failed`, and MariaDB, SQL Server and SQLite report `timeout` instead of `ok`. No code under `examples/`, `packages/` or `apps/` changed between the green and red runs. While it stays red, no PR can merge, which already blocks the 2026-10-25 test-campaign tickets (#510, #512).

The cause, read from the CI log and the code (not reproduced locally: no Docker daemon in triage's environment): `lab ui` runs each engine in its own forked worker and starts that engine's `--timeout` timer at the fork, so the worker's boot (TypeScript transpile through `tsx`, importing AskDB and every driver) counts against the timeout. The isolation run forks five workers at once while vitest runs other heavy test files in parallel, and on a loaded runner even SQLite, which needs no network, missed the test's 8 s timeout. The four failing tests after the first share one cached run, so they are one failure.

## Solution

The isolation test gives `lab ui` a `--timeout` of 30 s instead of 8 s. That is long enough for five concurrent worker boots plus the run on a loaded CI runner, so only the engine pointed at a socket that never answers reaches the timeout, as the test intends. The test still proves everything its header says: a down engine fails in its own column, a never-answering engine is reported `timeout` with `no result after <timeout> ms` and its column sent last, and the other engines complete, agree and match the oracle. `lab ui`'s behaviour, its 60 s default and the README's description of `--timeout` don't change. The fix counts only once the PR's own `consumer-lab` check is green.

## User Stories

1. As an AskDB contributor, I want the `consumer-lab` check green on `main`, so that my PR's checks reflect my change and not a flaky test.
2. As the maintainer, I want the blocked test-campaign PRs (#510, #512 and the ones after them) to merge once their own changes pass, so that the campaign isn't held up by an unrelated test.
3. As the maintainer, I want the isolation test to keep proving that a down engine fails only its own column, so that a regression that lets one engine's error fail the whole run is still caught.
4. As the maintainer, I want the isolation test to keep proving that a never-answering engine is reported `timeout` with `no result after <timeout> ms`, so that a hung engine that keeps the run from finishing is still caught.
5. As the maintainer, I want the test to keep proving that the timed-out engine's column is sent last, so that engines run one after another (a slow one holding the rest back) is still caught.
6. As the maintainer, I want the test to keep proving that the healthy engines return 7 rows, agree, match the oracle and leave the failed engines out of the agreement, so that a failed engine counted in the agreement is still caught.
7. As the maintainer, I want `lab-ui-shutdown`, which reuses the isolation run, to keep passing, so that `lab ui` still exits on SIGTERM while a timed-out engine's connection hangs.
8. As a lab user, I want `lab ui --timeout` to keep meaning what the README says, so that the fix to a test doesn't change the tool I run.
9. As a later contributor reading the test, I want a comment on `TIMEOUT_MS` saying it must exceed worker boot under CI load, so that nobody lowers it back to a value that flakes.
10. As the maintainer, I want the fix counted only when the PR's own `consumer-lab` check passes, so that a value that still flakes comes back to me with the CI log instead of being raised again unseen.
11. As a consumer-lab CI runner, I want the isolation run to finish well inside vitest's 120 s test timeout, so that the longer `--timeout` doesn't trade one timeout for another.

## Implementation Decisions

- **The one change (decision 1).** In the consumer lab's lab UI test, the isolation scenario's timeout constant goes from 8 000 ms to 30 000 ms. It is the only value that changes: it still feeds both the `--timeout` argument passed to `lab ui` and the assertions that read it (the `no result after <timeout> ms` error text and the healthy engines' `totalMs` bound), so they move together.
- **The comment (decision 1).** Above the constant, a short comment says the value must exceed a worker's boot under CI load (five workers fork at once while other test files run), which is why it is 30 s and not lower.
- **Assertions unchanged (decision 1, acceptance criteria).** No assertion is removed, reworded or loosened beyond the bound that already reads the constant: statuses, error strings, column order, `rowCount`, `totalMs` below the timeout, agreement verdict and groups, `notCompared`, oracle verdicts, and the shutdown test's `{ forced: false }`.
- **Nothing else changes (decision 1).** The lab UI server, the engine worker, the 60 s default `--timeout`, the lab README, the vitest config and the CI workflow stay as they are. No change under `packages/` or `apps/`, so no changeset.
- **Proof and its limit (decision 1's condition).** The fix is proven by a green `consumer-lab` check on the PR. If that check still shows healthy engines reporting `timeout` in the isolation cells, build does not raise the constant again: it escalates with the CI run's log for the owner to choose another shape (such as starting the timer when the worker is ready).
- **Headroom.** 30 s is about four times the 8 s that sufficed on an unloaded runner (other `lab ui` runs take 1.4 to 2 s per engine), well under vitest's 120 s test timeout (the run is `lab ui` start-up plus 30 s), and under the product's 60 s default.

## Testing Decisions

- **No new test.** The change is to an existing test's input; the five isolation cells and the shutdown cell are the tests, and they test external behaviour (they start the real `pnpm lab ui` and read its NDJSON over HTTP).
- **Where it's verified.** The lab needs the multi-engine fixture and an installed lab (`pnpm fixture:up`, `pnpm lab:use .`), then `pnpm lab:matrix`. Build runs it locally when Docker is available; the PR's `consumer-lab` check is the required proof either way, since the failure only showed under CI load.
- **What a pass looks like.** In the PR's `consumer-lab` run: `[postgres]` isolation passes with `no result after 30000 ms`, `[mysql]` fails with `ECONNREFUSED`, `[mariadb]`, `[sqlserver]` and `[sqlite]` are `ok`, and `lab-ui-shutdown` passes.
- **Prior art.** The scenario's own header comment (Protects / Catches / Not covered elsewhere) stays accurate and needs no edit, as the behaviour it protects is unchanged.

## Ticket coverage

| Ticket item (acceptance criteria) | Met by |
| --- | --- |
| The five `lab-ui-isolation` cells pass in the `consumer-lab` CI job on a loaded runner, independent of runner speed | Implementation Decisions: the one change; Proof and its limit (decision 1a) |
| The test still proves what its header says (down engine fails alone, never-answering engine `timeout` after `--timeout` and last, others complete, agree, match the oracle) | Implementation Decisions: assertions unchanged; Testing Decisions: what a pass looks like |
| `lab-ui-shutdown` still passes | Implementation Decisions: assertions unchanged; Testing Decisions: what a pass looks like |
| No assertion dropped or loosened | Implementation Decisions: assertions unchanged |
| If `--timeout` behaviour changes, the README says so | Not triggered: decision 1 leaves `lab ui` and its README unchanged |
| Brief: passes in `pnpm lab:matrix` with other files in parallel | Testing Decisions: where it's verified |
| Brief: if timeout semantics change, a lab test covers it | Not triggered: no semantics change (decision 1) |
| Brief: no changeset | Implementation Decisions: nothing else changes |

## Out of Scope

- Starting each engine's timer when its worker is ready, or at the start of the run (triage's option B): it changes `lab ui` behaviour and the README; it stays the fallback the owner may pick if the condition in decision 1a triggers.
- Reducing vitest's file parallelism, or changing the `consumer-lab` workflow.
- Any change to `packages/*` or `apps/*`.
- Other lab UI tests, and the 60 s default `--timeout`.

## Further Notes

- No new glossary terms or decision records: the grilling record lists none, as the change is test-only.
- The cause was read from the CI log and code, not reproduced locally; the PR's CI run is the first measurement under load.
