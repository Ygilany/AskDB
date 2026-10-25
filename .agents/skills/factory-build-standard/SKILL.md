---
name: factory-build-standard
description: "Run a standard-lane ticket's build stage: write failing acceptance tests first, implement until they pass, or fix the findings a review sent back, gate each test with factory-test-audit, push to the ticket's draft PR, then exit the stage with the factory CLI."
---

# Factory build (standard lane)

You are the implementer for one standard-lane ticket, running in its own worktree. Your brief names the ticket as `<repo>#<n>`. You build tests first against the approved spec, open the ticket's draft PR through `factory-open-pr`, and hand the ticket back to the `factory` CLI, which decides what happens next. Review follows you against that PR and only reports: when it finds blocking defects, the ticket comes back to you with them, and you are the one who fixes them (decision 0045).

Run every `factory` command from the worktree root, with `--json`. The CLI finds the project manifest from there: `.factory/project.yaml`, or for a contributor project the file its registry entry names in the factory checkout. `factory config check --json` prints it as `project`.

**The stage run.** The brief's exit commands (`factory ticket complete`, `fail` and `escalate`) end `--run <run id>`. Pass that `--run <run id>`, exactly as the brief has it, on every one of these commands, including those this skill spells out. If an output has `refused`, the ticket has left your run: reply with your result (what you would have recorded, and the refusal's reason), run no other exit command, and stop.

## 1. Confirm the ticket

1. Run `factory ticket show <n> --json`. Go on only when `state.lane` is `standard`, `state.stage` is `build` and `state.status` is `active`; otherwise reply with what you found and stop.
2. Read the ticket with `gh issue view <n> -R <host>/<repo> --comments`, where `<host>` is the tracker host (`tracker.host` in the manifest, `github.com` without one). The body holds the acceptance criteria; triage's sizing is in its report file (`reports.triage` in `factory ticket show <n> --json`, in this worktree), not in a comment. What the owner asked for (changes, answers, notes kept for this stage) is in your brief, under "What the owner said for this run".
3. Read the approved spec: the file at the `doc` path of the ledger's `stage_completed` event for `align` (`factory ledger list --ticket <n> --json`), in this worktree. The event's `artifact` is only the first comment of the spec on the ticket, and a long spec continues in more comments; use `artifact` for the spec only on a ticket aligned before `doc` existed.
4. Read the project's `AGENTS.md` (or `CLAUDE.md`) for its conventions.
5. If the brief says this stage is running again, sent back from review to build, this run is a **rework**: the reason it quotes lists the review's blocking findings, one `<file>:<line> <summary>` each, and the review's verdict comment on the PR has each one's failure scenario (`gh pr view --comments`). A run can also be sent back from merge, for red CI on the head or an owner's `/changes`: its reason says which. A PR that conflicts with its base never comes here: the sync stage merges the base into the branch (decision 2026-10-25-200), so merge conflicts are not build's to resolve.
6. If the brief says this stage is running again after a stalled review loop (a `sent_back` with a `condition`, which happens only when a stage configures an `on_stall` detour; none does today), read the detour stage's artifact (the `artifact` of its latest `stage_completed` event) and the latest `design_review` event (`factory ledger list --ticket <n> --json`) before changing code, and build the approach they describe rather than patching the last round's findings.

Done when each acceptance criterion reads as a behavior a test can check, or as one review checks by reading (see §2), and, in a rework, each finding reads as the failure it describes.

## 2. Build, tests first

Work on the worktree's branch. If it is the base branch (`base_branch` in the manifest), create the ticket's branch first (`state.branch` in `factory ticket show <n> --json`).

**A fresh build:** write failing acceptance tests from the spec's criteria, run them to see them fail for the expected reason, and commit them on their own (for example `test: …`) before any implementation commit. Then implement with the `factory-tdd` skill until they pass, adding unit tests as the code needs. Change a committed acceptance test only to fix a test that was wrong, never to fit the code, and say so in the commit message.

**A resumed build** starts from a branch that already has tests and code (a rework, a relaunched worker, an escalation resolved in build, or a ticket promoted from quick). Tests first then applies to behavior still missing, not to the whole ticket:

- Existing tests that check a criterion correctly stay as they are. A test that passes is not rewritten to fail first.
- A test that a review finding, or the note on a resolved escalation, named as wrong is fixed in its own commit, which says what was wrong with it.
- A finding about the code gets a test that fails on its failure scenario, committed before the fix that turns it green; the fix's commit names the finding. A finding you judge wrong stays unfixed, with a one-line reason you put in a PR comment, so the next round's reviewer weighs it.
- A criterion whose behavior is missing gets a failing test, committed before the code that makes it pass.
- A criterion whose behavior already works but has no test gets a test that passes from the start, committed on its own, with a message saying it covers existing behavior. Change no code to make it fail first.

**The order is checked at exit, on a fresh build only.** The CLI walks the commits you made after align's exit, oldest first, and refuses when the first one that changes a path outside the project's test paths (`test_paths`: `**/*.test.*`, `**/*.spec.*`, `test/**`, `tests/**` unless the project replaces them) has no earlier commit that changed a test path. So the failing tests go in a commit of their own, and docs, skills and every other non-test path count as code. A rework, a relaunched worker, an escalation resolved in build and a promoted ticket are not checked, and neither is a build that reports `test_audit=0`.

A criterion that no test in the project can run (a skill's prose, say, or a doc) gets no test: the PR body's Evidence names how review checks it.

Run the `factory-test-audit` skill's **authoring gate** on every test you wrote or changed, in a fresh build and a resumed one alike, and rewrite or drop each one that fails it; count them for `test_audit` (§4). Run the tests for what you changed, in the foreground: the test files you wrote or changed, and the test files of each source file you changed (those that import it or are named for it), with the runner the manifest's test tier uses (the file `factory config check --json` prints as `project`; say `bun test <files>`). Run in full each `test_tiers` command that checks the project without running its tests, such as a typecheck or a lint, and any test the project's `AGENTS.md` names for an area you touched. Leave the full suite to CI: its required check runs it on the PR, and the merge stage waits for it to pass (decision 2026-10-25-the-machine-caps-active-builds-and-ci-runs-the-full-suite). On a project with no CI (no files under `.github/workflows`) nothing else runs the suite, so there run every `test_tiers` command in full. Commit with conventional-commit messages.

Done when every criterion has a test or is named in the Evidence as checked by review, every finding in a rework has a fix or a reason, every test you wrote or changed passes the authoring gate, those tests and checks pass, and `git status` is clean.

If the tiers stay red after an honest attempt, or the ticket can't be built as written, run `factory ticket fail <n> --reason "<what blocks it>" --json`, reply with the reason, and stop.

If the build can't go on without the owner (a check in a screen no tool of yours reads, or a choice the spec leaves open), escalate it as an ask, as "Asking the owner" says: `factory ticket escalate <n> --reason "build: <what you need, in five words or fewer>; <the items>" --json`, then reply with the ask and stop. (A `fail` would escalate too, but as `build failed: <reason>`, with no items and no ask.)

**Children.** If you start agents of your own, their end is not their result: a reply that holds no result (a background command still running, "I'll report when it finishes") is **interim**. Don't act on it and don't end your turn: wait on the same child again (`task_status` until its `workState` is `result_available`, or `t3_thread_wait` on its thread), and if it is idle with no result, send it one follow-up asking for its result now and wait again. Use another child only when it fails or still gives none. Never end your turn while a child you started owes a reply (decision 2026-10-25-337-a-child-s-reply-without-its-result-is-interim).

## 3. Open or reuse the PR

Run the `factory-open-pr` skill for `<repo>#<n>` with `draft`, passing it your run id, telling it which criteria review checks by reading (§2), so a new PR's Evidence names them; in a rework it pushes the fixes to the PR that is already open. If it escalated, failed or reported `refused`, reply with what it reported and stop.

Done when it has returned the PR URL.

## 4. Exit the stage

Run `factory ticket complete <n> --evidence tests_green=true --evidence test_audit=<n> --json`, where `test_audit` is the number of tests you ran the authoring gate on (0 when no criterion has a runnable test, which also exempts the build from the order check); the CLI refuses a missing or malformed one. Leave `within_budget`, `tests_first` and `branch_pushed` out: the CLI computes them, the first from the branch's diff against the base, the second from the branch's commit order (§2), the third from your `HEAD` against `origin`'s copy of the ticket's branch. If it refuses with `push first`, run the push it names and complete again.

If it refuses with `tests first:`, it named a commit in a fresh build that changes a path outside the test paths with no earlier commit of a test. Rewrite the build's commits, which review hasn't read yet: `git reset --soft <the start commit it names>`, commit the test files on their own (`test: …`), then commit the rest, `git push --force-with-lease <remote> <branch>` as the refusal says, and complete again.

If `factory ticket complete` fails with `git fetch failed` (the base branch could not be fetched from `origin`), run it once more; a brief network failure has usually cleared by then. If it fails again, run `factory ticket escalate <n> --reason "<the git fetch failed: … message>" --json`, quoting that message from the error output in full (the output can open with other lines, such as a source excerpt, so its first line may not carry git's reason), and reply `escalated <repo>#<n>: <the message>`. Every other failure keeps "When the CLI fails".

Reply `built <repo>#<n>: <PR url>`, naming the PR's author if `factory-open-pr` reported one other than the project's identity.

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
