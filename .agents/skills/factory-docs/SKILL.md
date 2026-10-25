---
name: factory-docs
description: "Run a standard-lane ticket's docs stage: update the project's docs in the ticket's own PR with the factory's copy of diataxis-docs, draft the release notes and site copy in a separate draft marketing PR, then exit the stage with the marketing PR's link or none."
---

# Factory docs

You are the docs worker for one standard-lane ticket (`<repo>#<n>`), running in its own worktree, after build and before review. Your brief names the ticket and its stage run. You do two jobs from the same diff:

- **The docs.** The project's docs change with the code, committed to the ticket's own branch, so review reads them beside the code and the head review passes is the head that merges.
- **The copy.** Release notes and site copy for what the change says to its readers or the market, drafted in a separate **draft marketing PR**. The owner reads it at the `marketing_copy` gate before review, and publishes it themselves after the ticket's PR merges. You never merge, ready or close it, and it never closes the ticket.

Run every `factory` command from the worktree root, with `--json`, except `factory github-app token` inside a command substitution. The CLI finds the project manifest from there: `.factory/project.yaml`, or for a contributor project the file its registry entry names in the factory checkout. `factory config check --json` prints it as `project`.

**The stage run.** The brief's exit commands (`factory ticket complete`, `fail` and `escalate`) end `--run <run id>`. Pass that `--run <run id>`, exactly as the brief has it, on every one of these commands, including those this skill spells out. If an output has `refused`, the ticket has left your run: reply with your result (what you would have recorded, and the refusal's reason), run no other exit command, and stop.

**You run unattended.** Where the factory's copy of `diataxis-docs` (`diataxis-docs.md` in this skill's folder) says to offer or ask, such as creating a house style, use its defaults and say so in your reply. It, `TYPES.md`, `AUDIT.md`, `TOOLS.md` and `templates/` are in this folder; never search the disk for them. Of its two branches, you only ever take the one-page steps.

## 1. Confirm the ticket and read the change

1. Run `factory ticket show <n> --json`. Go on only when `state.lane` is `standard`, `state.stage` is `docs` and `state.status` is `active`; otherwise reply with what you found and stop. Note `state.branch` (the ticket's branch), `contributor`, and `artifacts`.
2. Read the project manifest (`project` in `factory config check --json`): `base_branch`, `docs.path` and `site.path`, whichever it declares. A project declares at least one, or the stage would have been skipped.
3. Read the ticket (`gh issue view <n> -R <host>/<repo> --comments`, `<host>` being `tracker.host` in the manifest, `github.com` without one) and the approved spec: the file at the `doc` path of the ledger's `stage_completed` event for `align` (`factory ledger list --ticket <n> --json`), in this worktree. On a contributor project the spec is the uncommitted `.factory/tmp/<n>/spec.md`.
4. Read what the change did: `git fetch origin <base_branch>`, then `git diff origin/<base_branch>...HEAD`, and the ticket's PR (its `pr_opened` event in the ledger, `gh pr view <url> --comments`).
5. Read the project's `AGENTS.md` (or `CLAUDE.md`) and its house style for docs (`diataxis-docs.md`, "House style"). The house style overrides the framework's defaults, and decides where release notes go.
6. If the brief says this stage is running again, the owner asked for changes at the `marketing_copy` gate, or a review sent the ticket back to build and it has come round to docs again. The owner's note is in your brief, under "What the owner said for this run": revise the copy (and the docs, if the note touches them) to it, and read your last run's marketing PR before you write anything.

Done when you can say in a sentence what the change does to a user of the project, or that it does nothing a user sees.

## 2. Update the docs

Only when the manifest declares `docs`. Run the page steps in `diataxis-docs.md` for each page under `docs.path` that the change makes wrong or missing: one type per page, the house style first, every factual claim traced to the code or a command you ran. A change no reader sees leaves the docs as they are. Create or move a page only when the change adds a feature the docs have no home for. Run the docs build and the link or prose checks the house style names.

Commit with a conventional message (`docs: …`) on the ticket's branch, then push it to the branch's remote: run `factory ticket push-target <n> --json` (it prints `{remote, head}`: `origin` for most projects, the owner's `fork` for a contributor project without write access), then `git push <remote> <state.branch>`, never forced. If the push is rejected because the branch moved, stop and escalate (§4): someone pushed to it.

Done when `git status` is clean and the branch is pushed.

## 3. Draft the copy

**Is there anything to announce?** Yes when a user of the project meets the change: its behavior, interface, configuration or output. No when it is internal (a refactor, a test, a tool only the maintainers run). When nothing is to be announced, there is no marketing PR: skip to §4 and report `none`.

**Where the copy goes.** On the branch `<state.branch>-marketing`, never on the ticket's branch. Work in a temporary git worktree, so the ticket's worktree stays on its branch with `git status` clean, which the exit requires. Remove it (`git worktree remove <dir>`) on every exit of this section, an escalation or a failure included:

- first run: `git worktree add <dir outside this worktree> -b <state.branch>-marketing origin/<base_branch>`;
- a later run, when the marketing branch is already on the remote: `git fetch <remote> <state.branch>-marketing`, then `git worktree add <dir> -B <state.branch>-marketing <remote>/<state.branch>-marketing`.

**What you write.**

- The **release notes**, in the place the house style names. Without one: with a `site`, `<site.path>/release-notes/<n>-<slug>.md`; without, `<docs.path>/release-notes/<n>-<slug>.md`, where `<slug>` is the slug of the ticket's branch. One file per ticket, never a shared `CHANGELOG`: marketing PRs are published in any order, and a shared file would conflict between them.
- With a `site`, the **site copy** the change touches under `site.path`: the pages a visitor reads, edited in the site's own voice and components.
- Write what a reader gains, not how it was built. State only what the code does: every claim traces to the diff or a command you ran. A claim you cannot verify stays out; if the copy needs a fact only the owner has, escalate (§4).

Commit with a conventional message (`docs: …`) and push to the same remote as §2: `git push -u <remote> <state.branch>-marketing`, never forced.

**Open or reuse the PR.** Look for the branch's PRs in every state: `gh pr list --repo <host>/<repo> --head <state.branch>-marketing --state all --json number,url,state,isDraft,body,author,headRepositoryOwner`. On a contributor project without write access, `--head` takes the branch name only: keep the PRs whose `headRepositoryOwner.login` is the owner named in `head` from `factory ticket push-target`.

`<head>` is `<state.branch>-marketing`, prefixed `<owner>:` on a fork (the owner `factory ticket push-target` names).

- **None:** open one, as the project's identity, with the identity rules of `factory-open-pr` §1: build the token from the manifest's `identity` (or `default_identities.<host>` in `factory.yaml`) and mint it inside the `gh pr create` command's own shell command, failing closed:

  ```sh
  t=$(factory github-app token --repo <repo> --identity <key>) && [ -n "$t" ] && GH_TOKEN=$t gh pr create --repo <host>/<repo> --base <base_branch> --head <head> --draft --title "<conventional docs: title>" --body-file <file>
  ```

  (`gh_user` identities and other hosts follow that section's table.) The title is a conventional `docs:` commit, such as `docs: release notes for the CSV export (#<n>)`. The body says what the copy announces and which files it adds, ends with the line `Part of #<n>`, and carries **no closing keyword**: never `Closes`, `Fixes` or `Resolves` before an issue, because publishing the PR must not close the ticket. Write the body with the `factory-pr` skill's plain style, but leave out its Merge Danger section and the `Closes #<n>` line: this PR is not merged by the factory. Write no AI disclaimer and no `<!-- factory:… -->` marker. A project's identity that cannot open it (the mint failed or printed nothing) is an escalation (§4), never a PR opened as someone else.
- **One, open and a draft:** reuse it. The push has updated it. If the copy's scope changed, update its body with `gh pr edit` under the same identity, keeping `Part of #<n>` and the rule against closing keywords.
- **One that is not an open draft** (the owner readied, merged or closed it), or **more than one open:** escalate (§4). Open no other PR and do not report `none`: `none` is only for a change with nothing to announce, and a published or closed PR is the owner's to direct.

After the push, remove the temporary worktree.

Done when exactly one open draft PR heads the marketing branch, `Part of #<n>` ends its body, and no closing keyword is in it, or when there is nothing to announce.

**Children.** If you start agents of your own, their end is not their result: a reply that holds no result (a background command still running, "I'll report when it finishes") is **interim**. Don't act on it and don't end your turn: wait on the same child again (`task_status` until its `workState` is `result_available`, or `t3_thread_wait` on its thread), and if it is idle with no result, send it one follow-up asking for its result now and wait again. Use another child only when it fails or still gives none. Never end your turn while a child you started owes a reply (decision 2026-10-25-337-a-child-s-reply-without-its-result-is-interim).

## 4. Exit the stage

First make sure the ticket's worktree is on `<state.branch>`, `git status` is clean and the branch is pushed (§2).

- **Done:** `factory ticket complete <n> --evidence marketing_pr=<the PR's link|none> --run <run id> --json`. Leave `branch_pushed` and `artifact` out: the CLI computes the first from your `HEAD` against the branch's remote copy, and records the link, once it has checked the PR (an open draft of this repo, not on the ticket's branch, its body closing no issue), as the stage's artifact. It refuses with the reason when the PR fails a check, or with `push first` when the branch isn't pushed: fix what it names and complete again. With a link, the ticket then waits at the `marketing_copy` gate for the owner's word; with `none`, it goes to review.
- **Needs the owner:** `factory ticket escalate <n> --reason "docs: <what you need, in five words or fewer>; <the items>" --run <run id> --json`, for a step only the owner can take or settle: no identity can open the marketing PR, the ticket's earlier marketing PR is no longer an open draft, the house style contradicts itself, a fact for the copy only they have, a push the remote rejected. Number the items in the reason; a question gets its options as letters and your recommendation (`1. <question>: A <answer> (recommended), B <other>`). Then end your turn with the same numbered items, written for the owner in the `factory-writing-for-decisions` house style, and a last line `Reply: /answer ok takes every recommendation · /answer 2B changes one · /changes <guidance>`.
- **Failed:** `factory ticket fail <n> --reason "<what went wrong>" --run <run id> --json` when the stage cannot be done as written; it escalates as `docs failed: <reason>`.

You never merge, ready or close the marketing PR, and you never run `factory ticket complete` with a link you have not opened. Commit your work to the branch before your last step: the next stage starts from this worktree, not from this conversation.

Then end your turn with one line: `documented <repo>#<n>: <marketing PR url or none>`, adding `(house style defaults used)` if you took the copy's defaults.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. Leave the ticket's labels and the CLI alone: the ticket waits in docs until someone looks.
