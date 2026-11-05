---
name: factory-open-pr
description: "Leave a factory ticket's branch with exactly one open PR, opened or reused as the project's identity, closing the ticket and recorded as pr_opened once. Called by the lanes' build skills with a mode: draft or ready."
---

# Factory open PR

You open, or reuse, the one PR for a factory ticket's branch. A lane's build skill calls you from inside its stage, so you run in the ticket's worktree after the caller has committed and `git status` is clean. You take the ticket as `<repo>#<n>` and a mode, `draft` or `ready`. You are not a stage skill: you never run `factory ticket complete`. Your only ticket command is `factory ticket escalate`, in the two cases §3 can't settle.

The mode only ever makes a PR less ready, never more:

- `draft`: a new PR opens as a draft, and a reused PR that isn't one becomes one.
- `ready`: a new PR opens ready. A reused PR keeps its state, so a reused draft stays a draft: a PR is reviewed before it leaves draft, and taking it out of draft is the merge stage's job.

Run every `factory` command from the worktree root, with `--json`, except `factory github-app token` inside a command substitution (§1).

**The stage run.** Your caller's brief names its stage run, and its exit commands end `--run <run id>`. Add that `--run <run id>` to each `factory ticket escalate` below. If its output has `refused`, the ticket has left the caller's run: tell the caller to stop, with the refusal's reason, and stop.

## 1. Resolve the identity

1. Read `base_branch` and `identity` from the project manifest (the file `factory config check --json` prints as `project`: `.factory/project.yaml`, or for a contributor project one in the factory checkout). Without an `identity`, use `default_identities.<tracker host>` from `factory.yaml` (the path `factory --help` prints as the `--config` default). The tracker host is the manifest's `tracker.host`, or `github.com` without one.
2. Look the identity up in `factory.yaml`'s `identities` and build the token every `gh` write below uses:

   | Identity | Token for `gh` |
   |---|---|
   | `github_app` | `GH_TOKEN=$(factory github-app token --repo <repo> --identity <key>)`. Always pass `--identity`: without it the command picks the only App in `factory.yaml`, or fails when there are several. Leave out `--json`, which prints `{token, expires_at}` instead of the bare token. |
   | `gh_user` with `user:` | `GH_TOKEN=$(gh auth token --hostname <host> --user <user>)` |
   | `gh_user` without `user:` | none: plain `gh`, as whoever is logged in for the host |

   On hosts other than `github.com` the variable is `GH_ENTERPRISE_TOKEN`. That variable picks credentials, not the host, so every `gh pr` command also names the host: `--repo <host>/<owner>/<repo>` (for example `--repo github.com/Ygilany/factory`). Commands given the PR URL (`gh pr ready`, `gh pr edit`, `gh pr view`) already carry the host. `factory github-app token --repo` keeps the plain `<owner>/<repo>`.

A token is never stored or carried between commands: mint it inside each `gh` write's own shell command, and fail closed. An empty substitution would run `gh` as whoever is logged in and still exit 0:

```sh
t=$(factory github-app token --repo <repo> --identity <key>) && [ -n "$t" ] && GH_TOKEN=$t gh pr create …
```

If the mint fails or prints nothing, stop and tell the caller the command and its error.

Done when you have the base branch, the tracker host and the token (or know to use plain `gh`).

## 2. Push

Run `factory ticket push-target <n> --json`: it prints `{remote, head}`, `origin` and the branch for most projects, and for a contributor project without write access the owner's fork (it makes the fork and adds the `fork` remote when they are missing) and `<owner>:<branch>`. Then `git push -u <remote> HEAD`. The push uses the machine's git credentials.

Done when the remote branch's head is the local `HEAD`.

## 3. Find the branch's open PRs

Run `gh pr list --repo <host>/<repo> --head <branch> --state open --json number,url,headRefName,headRefOid,headRepositoryOwner,baseRefName,isDraft,body,author`, where `<branch>` is the `head` from §2 without any `<owner>:` prefix, since `--head` here takes a branch name only. When `head` is `<owner>:<branch>`, keep only the PRs whose `headRepositoryOwner.login` is `<owner>`, then count as below.

- **None:** write the body with the `factory-pr` skill, keeping its `## Merge Danger` section: a `**Door:**` line saying `one-way` or `two-way`, and a `**Blast Radius:**` line of at most 40 characters. Merge reads both from the body, and a body without them merges as `one-way` and `unknown`. Link the ticket's spec when it has one (the ledger's `stage_completed` event for `align`, from `factory ledger list --ticket <n> --json`: the file at the event's `doc` path is the spec the owner approved, and the event's `artifact` is its first comment on the ticket, where a long spec continues in the comments after it), put `Closes #<n>` on its own line, and, when the caller names criteria that review checks by reading, name them in the body's Evidence. When `factory ticket show <n> --json` prints `artifacts` as `thread`, no comment holds the spec: link it by its path on the branch, except when `contributor` is `true` in the same output, where the spec is an uncommitted file that is not on the branch: link no spec at all, and still put `Closes #<n>` on its own line. Write no AI disclaimer and no `<!-- factory:… -->` marker anywhere in the body, since the PR reads as an ordinary contribution. Open the PR with the identity's token:

  ```sh
  gh pr create --repo <host>/<repo> --base <base_branch> --head <head> --title "<conventional-commit title>" --body-file <file>
  ```

  Add `--draft` in `draft` mode.
- **One:** reuse it. The push has already updated it. Then repair what can be repaired, with the identity's token:
  - not a draft in `draft` mode: `gh pr ready --undo <url>`. Nothing else changes a PR's draft state: in `ready` mode a draft stays a draft;
  - no `Closes #<n>` line in the body: add one with `gh pr edit <url> --body-file <file>`, keeping the rest of the body;
  - no `## Merge Danger` section with `**Door:**` and `**Blast Radius:**` lines: add one in the `factory-pr` skill's form the same way;
  - a base other than `base_branch`: run `factory ticket escalate <n> --reason "PR <url> targets <base>, not <base_branch>" --json`, tell the caller to stop, and stop. Retargeting can pull in unrelated commits;
  - an author other than the project's identity (a PR someone opened by hand): keep it, since a PR's author can't change and a second PR would split the review. Name the author to the caller. Exception: when the identity is a `github_app` and the author is the logged-in user, no `pr_opened` event exists for the PR (§4) and it was not opened by hand, treat it as a failed token mint: run `factory ticket escalate <n> --reason "PR <url> was opened as <author>, not the project's identity" --json`, tell the caller to stop, and stop.
- **More than one:** run `factory ticket escalate <n> --reason "<count> open PRs for <branch>: <urls>" --json`, tell the caller to stop, and stop.

Done when exactly one open PR heads the branch, against `base_branch`, a draft in `draft` mode, and its body closes the ticket and holds a Merge Danger section.

## 4. Record the opening

Read the PR's `number,url,headRefName,headRefOid`. Run `factory ledger list --ticket <n> --json`. When it has no `pr_opened` event for this PR number, record one:

```sh
factory ledger record <n> --type pr_opened --json --data '{"pr":<number>,"url":"<url>","branch":"<headRefName>","headSha":"<headRefOid>"}'
```

A PR that already has its event (a send-back, a promotion) records nothing new: a head SHA that moves after the opening is not a new opening. A reused PR with no event, such as one opened by hand, gets one with its current values.

Done when the ledger has a `pr_opened` event for the PR's number, the PR's `headRefOid` is the branch's `HEAD` (the event's own `headSha` stays the opening's), and, for a PR this run opened, `gh pr view <url> --json author` reports the project's identity (`app/<slug>` for an App). Return the PR URL to the caller.

## When the CLI or `gh` fails

Tell the caller the command you ran and the first line of its error, and that it should stop.
