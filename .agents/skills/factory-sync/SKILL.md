---
name: factory-sync
description: "Run a sync detour: merge origin/<base> into the ticket's PR branch as one merge commit, resolve any conflict, rerun the project's tests, push, then exit the stage with the factory CLI."
---

# Factory sync

You are the syncer for one ticket, running in its own worktree. Your brief names the ticket as `<repo>#<n>`, the PR, the base branch, and the **checked head**: the PR head that review passed, or that an earlier clean sync produced. The PR conflicted with `<base>` at merge or in the merge gate's veto window (decision 2026-10-25-200), and the ticket came here instead of back to build. Your whole job is to bring the base into the branch and show the tests still pass. You rework nothing else: the ticket's tests, code and PR are review's and build's.

Run every `factory` command from the worktree root, with `--json`. The CLI finds the project manifest from there: `.factory/project.yaml`, or for a contributor project the file its registry entry names in the factory checkout.

**The stage run.** The brief's exit commands (`factory ticket complete`, `fail` and `escalate`) end `--run <run id>`. Pass that `--run <run id>`, exactly as the brief has it, on every one of these commands. If an output has `refused`, the ticket has left your run: reply with your result and the refusal's reason, run no other exit command, and stop.

## 1. Confirm the ticket

1. Run `factory ticket show <n> --json`. Go on only when `state.stage` is `sync` and `state.status` is `active`; otherwise reply with what you found and stop.
2. Take the PR, the base and the checked head from your brief, and the branch's remote from `factory ticket push-target <n> --json` (`origin`, or `fork` for a contributor project without write access). Fetch the remote's copy of the branch first (`git fetch <remote> <branch>`; a predecessor may have pushed a merge from another worktree, which a worker at the checked head would not otherwise see) and record its SHA once as `<remote head>` (`git rev-parse FETCH_HEAD`): every later `git fetch` overwrites `FETCH_HEAD`, so use the recorded SHA, not `FETCH_HEAD`, from here on. Then compare `git rev-parse HEAD` with the checked head:
   - **Behind `<remote head>`** (`HEAD` is an ancestor of it, including `HEAD` at the checked head): `git merge --ff-only <remote head>`, and compare again. If the remote's branch has commits the checked head lacks that are not a descendant of it, stop and escalate.
   - **At the checked head, and `<remote head>` is the checked head:** go on to §2.
   - **Past the checked head:** it is your predecessor's merge when all of these hold: `HEAD` has exactly two parents and the first is the checked head; the second is in `origin/<base>` (`git fetch origin <base>`, then `git merge-base --is-ancestor <second parent> origin/<base>`); and the remote's branch is at `HEAD` (`<remote head>` is `HEAD`). Then the merge and its tests are already done: skip §2 and §3 and go to §4's **Done** with `HEAD`'s SHA as `head_sha`. Anything else past the checked head (a plain commit, a merge onto another parent, a merge not pushed) is a head nobody checked: stop and escalate.
3. Read the project's `AGENTS.md` (or `CLAUDE.md`) for its conventions, and its `test_tiers`.

Done when you are on the checked head, clean, or have found your predecessor's pushed merge.

## 2. Merge the base

Merge the fetched base into the branch as **one merge commit**: `git fetch origin <base>`, then `git merge --no-ff origin/<base>`. No rebase, no force-push, no squash, and merge nothing but `origin/<base>`.

- **No conflict:** git commits the merge. Leave it exactly as it made it: the CLI records the merge `clean` only when git's own merge of the same two parents gives this tree, so any edit you add inside the merge makes it `resolved`, and review reads it.
- **A conflict:** resolve each file keeping both sides' intent: the base's new behavior and the ticket's change. Read the PRs and commits behind each side when the right answer isn't plain. Make only the edits the merge needs for the project's tests to pass (a call site the base renamed, a duplicate declaration); do not rework the ticket, fix what you notice elsewhere or touch its tests to make them pass. Then `git add` and `git commit` to finish the merge commit.

If you cannot resolve a conflict without changing what the ticket does, or choosing between two sides' behavior that the spec does not decide, do not guess: escalate (§4).

Done when `git status` is clean and `HEAD` is a merge commit whose parents are the checked head and a commit of `origin/<base>`.

## 3. Test and push

Run every command under `test_tiers` in the project manifest (the file `factory config check --json` prints as `project`). If a tier fails on a change the merge brought in, fix it with the smallest edit the merge needs and fold it into the merge commit before you push (`git commit --amend --no-edit`): `HEAD` must stay the one merge commit, and an edit inside it makes the merge `resolved`. If the tiers stay red after an honest attempt, escalate (§4): this is not build's to retry.

Then push to the branch's remote, never forced: run `factory ticket push-target <n> --json` (it prints `{remote, head}`: `origin` for most projects, the owner's `fork` for a contributor project without write access, where `origin` would reject the push), then `git push <remote> <branch>`. The base is still fetched from `origin`. If the push is rejected because the branch moved, stop and escalate: someone pushed to it.

Done when every tier passes and the branch is pushed.

## 4. Exit the stage

- **Done:** `factory ticket complete <n> --evidence tests_green=true --evidence pr=<PR link> --evidence head_sha=<full SHA of HEAD> --run <run id> --json`. Leave `branch_pushed` and `synced` out: the CLI computes them, the first from your `HEAD` against the branch's remote copy (`origin`'s, or the `fork`'s on a contributor project), the second by checking `HEAD` is a merge of the checked head and the fetched base and whether git's own merge gives its tree. It refuses, writing nothing, when `HEAD` is not that merge (it says why) or the branch is not pushed. A clean merge goes back to merge for CI on the new head; a resolved one goes to review for one round over the merge commit.
- **Stuck:** `factory ticket escalate <n> --reason "<what you need from a human>" --run <run id> --json`, for a conflict you cannot resolve without reworking the ticket, tests that stay red after the merge, a push the remote rejected, or a branch that is not at the checked head. The ticket waits for the owner. It does not go to build and it spends none of merge's send-backs.
- **Failed:** `factory ticket fail <n> --reason "<what went wrong>" --run <run id> --json` escalates the same way, as `sync failed: <reason>`.

Commit your work to the branch before your last step. Then end your turn with one line: `synced <repo>#<n>: <clean|resolved> at <short sha>` when done, or `sync escalated` / `sync failed`.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. Leave the ticket's labels and the CLI alone: the ticket waits in sync until someone looks.
