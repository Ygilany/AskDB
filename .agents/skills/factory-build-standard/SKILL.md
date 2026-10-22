---
name: factory-build-standard
description: "Run a standard-lane ticket's build stage: write failing acceptance tests first, implement until they pass, or fix the findings a review sent back, gate each test with test-audit, push to the ticket's draft PR, then exit the stage with the factory CLI."
---

# Factory build (standard lane)

You are the implementer for one standard-lane ticket, running in its own worktree. Your brief names the ticket as `<repo>#<n>`. You build tests first against the approved spec, open the ticket's draft PR through `factory-open-pr`, and hand the ticket back to the `factory` CLI, which decides what happens next. Review follows you against that PR and only reports: when it finds blocking defects, the ticket comes back to you with them, and you are the one who fixes them (decision 0045).

Run every `factory` command from the worktree root, with `--json`. The CLI finds the project manifest (`.factory/project.yaml`) from there.

## 1. Confirm the ticket

1. Run `factory ticket show <n> --json`. Go on only when `state.lane` is `standard`, `state.stage` is `build` and `state.status` is `active`; otherwise reply with what you found and stop.
2. Read the ticket with `gh issue view <n> -R <host>/<repo> --comments`, where `<host>` is the tracker host (`tracker.host` in the manifest, `github.com` without one). The body holds the acceptance criteria; triage's sizing is in its report file (`reports.triage` in `factory ticket show <n> --json`, in this worktree), not in a comment. What the owner asked for (changes, answers, notes kept for this stage) is in your brief, under "What the owner said for this run".
3. Read the approved spec: the file at the `doc` path of the ledger's `stage_completed` event for `align` (`factory ledger list --ticket <n> --json`), in this worktree. The event's `artifact` is only the first comment of the spec on the ticket, and a long spec continues in more comments; use `artifact` for the spec only on a ticket aligned before `doc` existed.
4. Read the project's `AGENTS.md` (or `CLAUDE.md`) for its conventions.
5. If the brief says this stage is running again, sent back from review to build, this run is a **rework**: the reason it quotes lists the review's blocking findings, one `<file>:<line> <summary>` each, and the review's verdict comment on the PR has each one's failure scenario (`gh pr view --comments`).
6. If the brief says this stage is running again after a stalled review loop (a `sent_back` with a `condition`, which happens only when a stage configures an `on_stall` detour; none does today), read the detour stage's artifact (the `artifact` of its latest `stage_completed` event) and the latest `design_review` event (`factory ledger list --ticket <n> --json`) before changing code, and build the approach they describe rather than patching the last round's findings.

Done when each acceptance criterion reads as a behavior a test can check, or as one review checks by reading (see §2), and, in a rework, each finding reads as the failure it describes.

## 2. Build, tests first

Work on the worktree's branch. If it is the base branch (`base_branch` in the manifest), create the ticket's branch first (`state.branch` in `factory ticket show <n> --json`).

**A fresh build:** write failing acceptance tests from the spec's criteria, run them to see them fail for the expected reason, and commit them on their own (for example `test: …`) before any implementation commit. Then implement with the `tdd` skill until they pass, adding unit tests as the code needs. Change a committed acceptance test only to fix a test that was wrong, never to fit the code, and say so in the commit message.

**A resumed build** starts from a branch that already has tests and code (a rework, a relaunched worker, an escalation resolved in build, or a ticket promoted from quick). Tests first then applies to behavior still missing, not to the whole ticket:

- Existing tests that check a criterion correctly stay as they are. A test that passes is not rewritten to fail first.
- A test that a review finding, or the note on a resolved escalation, named as wrong is fixed in its own commit, which says what was wrong with it.
- A finding about the code gets a test that fails on its failure scenario, committed before the fix that turns it green; the fix's commit names the finding. A finding you judge wrong stays unfixed, with a one-line reason you put in a PR comment, so the next round's reviewer weighs it.
- A criterion whose behavior is missing gets a failing test, committed before the code that makes it pass.
- A criterion whose behavior already works but has no test gets a test that passes from the start, committed on its own, with a message saying it covers existing behavior. Change no code to make it fail first.

A criterion that no test in the project can run (a skill's prose, say, or a doc) gets no test: the PR body's Evidence names how review checks it.

Run the pinned `test-audit` skill's **authoring gate** on every test you wrote or changed, in a fresh build and a resumed one alike, and rewrite or drop each one that fails it. Run every command under `test_tiers` in `.factory/project.yaml`. Commit with conventional-commit messages.

Done when every criterion has a test or is named in the Evidence as checked by review, every finding in a rework has a fix or a reason, every test you wrote or changed passes the authoring gate, every tier passes, and `git status` is clean.

If the tiers stay red after an honest attempt, or the ticket can't be built as written, run `factory ticket fail <n> --reason "<what blocks it>" --json`, reply with the reason, and stop.

## 3. Open or reuse the PR

Run the `factory-open-pr` skill for `<repo>#<n>` with `draft`, telling it which criteria review checks by reading (§2), so a new PR's Evidence names them; in a rework it pushes the fixes to the PR that is already open. If it escalated or failed, reply with what it reported and stop.

Done when it has returned the PR URL.

## 4. Exit the stage

Run `factory ticket complete <n> --evidence tests_green=true --json`. Leave `within_budget` out: the CLI computes it from the branch's diff against the base.

If `factory ticket complete` fails with `git fetch failed` (the base branch could not be fetched from `origin`), run it once more; a brief network failure has usually cleared by then. If it fails again, run `factory ticket escalate <n> --reason "<the git fetch failed: … message>" --json`, quoting that message from the error output in full (the output can open with other lines, such as a source excerpt, so its first line may not carry git's reason), and reply `escalated <repo>#<n>: <the message>`. Every other failure keeps "When the CLI fails".

Reply `built <repo>#<n>: <PR url>`, naming the PR's author if `factory-open-pr` reported one other than the project's identity.

Done when `factory ticket complete` has succeeded and you have replied.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. Leave the ticket's labels and the CLI alone: the ticket waits in build until someone looks.
