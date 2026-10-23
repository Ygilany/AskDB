---
name: factory-build-quick
description: "Run a quick-lane ticket's build stage: implement it test-first in this worktree, or fix the findings a review sent back, gate each test with test-audit, push through factory-open-pr, then exit the stage with the factory CLI."
---

# Factory build (quick lane)

You are the implementer for one quick-lane ticket, running in its own worktree. Your brief names the ticket as `<repo>#<n>`. You write the code and its tests in one pass, open the PR as the project's identity through `factory-open-pr`, and hand the ticket back to the `factory` CLI, which decides what happens next. Review follows you and only reports: when it finds blocking defects, the ticket comes back to you with them, and you are the one who fixes them (decision 0045).

Run every `factory` command from the worktree root, with `--json`. The CLI finds the project manifest (`.factory/project.yaml`) from there.

## 1. Confirm the ticket

1. Run `factory ticket show <n> --json`. Go on only when `state.lane` is `quick`, `state.stage` is `build` and `state.status` is `active`; otherwise reply with what you found and stop.
2. Read the ticket with `gh issue view <n> -R <repo> --comments`. The body holds the acceptance criteria; triage's sizing is in its report file (`reports.triage` in `factory ticket show <n> --json`, in this worktree), not in a comment. What the owner asked for (changes, answers, notes kept for this stage) is in your brief, under "What the owner said for this run".
3. Read the project's `AGENTS.md` (or `CLAUDE.md`) for its conventions.
4. If the brief says this stage is running again, sent back from review to build, this run is a **rework**: the reason it quotes lists the review's blocking findings, one `<file>:<line> <summary>` each, and the review's verdict comment on the PR has each one's failure scenario (`gh pr view --comments`).
5. If the brief says this stage is running again after a stalled review loop (a `sent_back` with a `condition`, which happens only when a stage configures an `on_stall` detour; none does today), read the detour stage's artifact (the `artifact` of its latest `stage_completed` event) and the latest `design_review` event (`factory ledger list --ticket <n> --json`) before changing code, and build the approach they describe rather than patching the last round's findings.

Done when you can state each acceptance criterion as a behavior a test can check, and, in a rework, each finding as the failure it describes.

## 2. Build

1. Work on the worktree's branch. If it is the base branch (`base_branch` in the manifest), create the ticket's branch first (`state.branch` in `factory ticket show <n> --json`).
2. Implement with the `tdd` skill, one acceptance criterion at a time: a test goes red, then the code turns it green. In a rework, take each finding the same way: a test that fails on the failure scenario, then the fix that turns it green. A finding you judge wrong stays unfixed, with a one-line reason you put in a PR comment, so the next round's reviewer weighs it.
3. Run the pinned `test-audit` skill's **authoring gate** on every test you wrote or changed, and rewrite or drop each one that fails it.
4. Run every command under `test_tiers` in `.factory/project.yaml`.
5. Commit with conventional-commit messages, a rework's naming the finding each commit fixes.

The quick lane has a diff budget, and the tripwire reads committed work only (`git diff <base>...HEAD`). Keep the change to what the criteria ask for; a refactor the ticket doesn't need belongs in its own ticket.

Done when every criterion (and, in a rework, every finding) has a test or a reason, every test you wrote or changed passes the authoring gate, every `test_tiers` command passes, and `git status` is clean.

If the tiers stay red after an honest attempt, or the ticket can't be built as written, run `factory ticket fail <n> --reason "<what blocks it>" --json`, reply with the reason, and stop.

## 3. Open the PR

Run the `factory-open-pr` skill for `<repo>#<n>` with `ready`; in a rework it pushes the fixes to the PR that is already open. If it escalated or failed, reply with what it reported and stop.

Done when it has returned the PR URL.

## 4. Exit the stage

Run `factory ticket complete <n> --evidence tests_green=true --json`. Leave `within_budget` out: the CLI computes it from the branch's diff against the base.

If `factory ticket complete` fails with `git fetch failed` (the base branch could not be fetched from `origin`), run it once more; a brief network failure has usually cleared by then. If it fails again, run `factory ticket escalate <n> --reason "<the git fetch failed: … message>" --json`, quoting that message from the error output in full (the output can open with other lines, such as a source excerpt, so its first line may not carry git's reason), and reply `escalated <repo>#<n>: <the message>`. Every other failure keeps "When the CLI fails".

Read the result:

- **The lane is still `quick`:** the build passed. Reply `built <repo>#<n>: <PR url>`.
- **The lane changed to `standard`:** the diff tripped the quick-lane budget, and the ticket moves to standard's next stage. The PR stays as a reference for that work: run the `factory-open-pr` skill again with `draft`, which turns the PR back into a draft with the project's identity and records nothing new, get the tripwire reasons from `factory lane check --lane quick --json`, and reply `promoted <repo>#<n> to standard: <reasons>; draft PR <url> kept as reference`.

Done when `factory ticket complete` has succeeded and you have replied.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. Leave the ticket's labels and the CLI alone: the ticket waits in build until someone looks.
