---
name: factory-build-quick
description: "Run a quick-lane ticket's build stage: implement it test-first in this worktree, or fix the findings a review sent back, gate each test with factory-test-audit, push through factory-open-pr, then exit the stage with the factory CLI."
---

# Factory build (quick lane)

You are the implementer for one quick-lane ticket, running in its own worktree. Your brief names the ticket as `<repo>#<n>`. You write the code and its tests in one pass, open the PR as the project's identity through `factory-open-pr`, and hand the ticket back to the `factory` CLI, which decides what happens next. Review follows you and only reports: when it finds blocking defects, the ticket comes back to you with them, and you are the one who fixes them (decision 0045).

Run every `factory` command from the worktree root, with `--json`. The CLI finds the project manifest from there: `.factory/project.yaml`, or for a contributor project the file its registry entry names in the factory checkout. `factory config check --json` prints it as `project`.

**The stage run.** The brief's exit commands (`factory ticket complete`, `fail` and `escalate`) end `--run <run id>`. Pass that `--run <run id>`, exactly as the brief has it, on every one of these commands, including those this skill spells out. If an output has `refused`, the ticket has left your run: reply with your result (what you would have recorded, and the refusal's reason), run no other exit command, and stop.

## 1. Confirm the ticket

1. Run `factory ticket show <n> --json`. Go on only when `state.lane` is `quick`, `state.stage` is `build` and `state.status` is `active`; otherwise reply with what you found and stop.
2. Read the ticket with `gh issue view <n> -R <repo> --comments`. The body holds the acceptance criteria; triage's sizing is in its report file (`reports.triage` in `factory ticket show <n> --json`, in this worktree), not in a comment. What the owner asked for (changes, answers, notes kept for this stage) is in your brief, under "What the owner said for this run".
3. Read the project's `AGENTS.md` (or `CLAUDE.md`) for its conventions.
4. If the brief says this stage is running again, sent back from review to build, this run is a **rework**: the reason it quotes lists the review's blocking findings, one `<file>:<line> <summary>` each, and the review's verdict comment on the PR has each one's failure scenario (`gh pr view --comments`). A run can also be sent back from merge, for red CI on the head or an owner's `/changes`: its reason says which. A PR that conflicts with its base never comes here: the sync stage merges the base into the branch (decision 2026-10-25-200), so merge conflicts are not build's to resolve.
5. If the brief says this stage is running again after a stalled review loop (a `sent_back` with a `condition`, which happens only when a stage configures an `on_stall` detour; none does today), read the detour stage's artifact (the `artifact` of its latest `stage_completed` event) and the latest `design_review` event (`factory ledger list --ticket <n> --json`) before changing code, and build the approach they describe rather than patching the last round's findings.

Done when you can state each acceptance criterion as a behavior a test can check, and, in a rework, each finding as the failure it describes.

## 2. Build

1. Work on the worktree's branch. If it is the base branch (`base_branch` in the manifest), create the ticket's branch first (`state.branch` in `factory ticket show <n> --json`).
2. Implement with the `factory-tdd` skill, one acceptance criterion at a time: a test goes red, then the code turns it green. In a rework, take each finding the same way: a test that fails on the failure scenario, then the fix that turns it green. A finding you judge wrong stays unfixed, with a one-line reason you put in a PR comment, so the next round's reviewer weighs it.
3. Run the `factory-test-audit` skill's **authoring gate** on every test you wrote or changed, and rewrite or drop each one that fails it.
4. Run the tests for what you changed, in the foreground: the test files you wrote or changed, and the test files of each source file you changed (those that import it or are named for it), with the runner the manifest's test tier uses (the file `factory config check --json` prints as `project`; say `bun test <files>`). Run in full each `test_tiers` command that checks the project without running its tests, such as a typecheck or a lint, and any test the project's `AGENTS.md` names for an area you touched. Leave the full suite to CI: its required check runs it on the PR, and the merge stage waits for it to pass (decision 2026-10-25-the-machine-caps-active-builds-and-ci-runs-the-full-suite). On a project with no CI (no files under `.github/workflows`) nothing else runs the suite, so there run every `test_tiers` command in full.
5. Commit with conventional-commit messages, a rework's naming the finding each commit fixes.

The quick lane has a diff budget, and the tripwire reads committed work only (`git diff <base>...HEAD`). Keep the change to what the criteria ask for; a refactor the ticket doesn't need belongs in its own ticket.

Done when every criterion (and, in a rework, every finding) has a test or a reason, every test you wrote or changed passes the authoring gate, the tests and checks step 4 runs pass, and `git status` is clean.

If they stay red after an honest attempt, or the ticket can't be built as written, run `factory ticket fail <n> --reason "<what blocks it>" --json`, reply with the reason, and stop.

If the build can't go on without the owner (a check in a screen no tool of yours reads, or a choice the spec leaves open), escalate it as an ask, as "Asking the owner" says: `factory ticket escalate <n> --reason "build: <what you need, in five words or fewer>; <the items>" --json`, then reply with the ask and stop. (A `fail` would escalate too, but as `build failed: <reason>`, with no items and no ask.)

**Children.** If you start agents of your own, their end is not their result: a reply that holds no result (a background command still running, "I'll report when it finishes") is **interim**. Don't act on it and don't end your turn: wait on the same child again (`task_status` until its `workState` is `result_available`, or `t3_thread_wait` on its thread), and if it is idle with no result, send it one follow-up asking for its result now and wait again. Use another child only when it fails or still gives none. Never end your turn while a child you started owes a reply (decision 2026-10-25-337-a-child-s-reply-without-its-result-is-interim).

## 3. Open the PR

Run the `factory-open-pr` skill for `<repo>#<n>` with `ready`, passing it your run id; in a rework it pushes the fixes to the PR that is already open. If it escalated, failed or reported `refused`, reply with what it reported and stop.

Done when it has returned the PR URL.

## 4. Exit the stage

Run `factory ticket complete <n> --evidence tests_green=true --evidence test_audit=<n> --json`, where `test_audit` is the number of tests you ran the authoring gate on (0 when no criterion has a runnable test); the CLI refuses a missing or malformed one. Leave `within_budget`, `tests_first` and `branch_pushed` out: the CLI computes them, the first from the branch's diff against the base, the second from the branch's commit order (it checks nothing in this lane), the third from your `HEAD` against `origin`'s copy of the ticket's branch. If it refuses with `push first`, run the push it names and complete again.

If `factory ticket complete` fails with `git fetch failed` (the base branch could not be fetched from `origin`), run it once more; a brief network failure has usually cleared by then. If it fails again, run `factory ticket escalate <n> --reason "<the git fetch failed: … message>" --json`, quoting that message from the error output in full (the output can open with other lines, such as a source excerpt, so its first line may not carry git's reason), and reply `escalated <repo>#<n>: <the message>`. Every other failure keeps "When the CLI fails".

Read the result:

- **The lane is still `quick`:** the build passed. Reply `built <repo>#<n>: <PR url>`.
- **The lane changed to `standard`:** the diff tripped the quick-lane budget, and the ticket moves to standard's next stage. The PR stays as a reference for that work: run the `factory-open-pr` skill again with `draft`, which turns the PR back into a draft with the project's identity and records nothing new, get the tripwire reasons from `factory lane check --lane quick --json`, and reply `promoted <repo>#<n> to standard: <reasons>; draft PR <url> kept as reference`.

Done when `factory ticket complete` has succeeded and you have replied.

## Asking the owner

An escalation that asks the owner to decide or to do something has two parts, written from one numbered list. This section is the same in `factory-align`, `factory-triage`, `factory-build-standard` and `factory-build-quick`: change the four together.

1. **The reason** (`--reason`) is one line, in the form the step that escalates gives. The next run's brief quotes it beside the owner's answer, so a short answer such as `ok 2B` still says what it chose. Number its items. A question gets its options as letters and your recommendation: `1. <question>: A <answer> (recommended), B <other>`. A step only the owner can take gets what to do and the reply that says it's done.
2. **The ask** is your last reply: the same numbered items, written for the owner as one round of the `factory-writing-for-decisions` house style, with every part below. Run its "Before you send" checks on it.
   - A round header: `Round <k> · <topic>`, then the counts line.
   - A decision map, when there are three or more questions or one waits on another.
   - The summary table `| # | Decision | Recommend | Undo |`, one-way questions first. The undo rating, one-way or two-way, is a required field of every question: in its table row and on its card.
   - A card for each question, in the table's order, recommendation first, then the options, one `Why` line and a `Checked:` line for each fact it rests on.
   - A diagram in a `mermaid` code fence, never ASCII, where a question has a shape, with what the answer changes highlighted and labelled.
   - A step only the owner can take keeps its form: what to do and the reply that says it's done, with no options or undo rating.
   - The last line is the reply line: `Reply: /answer ok takes every recommendation · /answer 2B changes one · /changes <guidance>`, where a step names its own reply in place of `ok`, such as `/answer done`.

   The ticket thread posts the ask under the escalation's first line, in place of the reason, and publishes it as a rendered page.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. Leave the ticket's labels and the CLI alone: the ticket waits in build until someone looks.
