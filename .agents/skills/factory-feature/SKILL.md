---
name: factory-feature
description: "The feature front door: grill the owner on a feature idea in this thread, write its spec, break it into tickets with the owner, file the parent issue and its children as native sub-issues, start them in the factory, and carry on as the parent's ticket thread."
disable-model-invocation: true
---

# Factory feature

The owner runs this in a fresh thread of a project's T3 project: `/factory-feature <idea>`. This thread is the **feature thread** (decisions 0043, 0044): it grills the owner, writes the spec, splits it into tickets with them, files and starts the tickets, and then carries the parent as its **ticket thread**. Nothing stops between the grilling and the build but what the project's autonomy profile asks for.

It composes the factory's copies of three skills from `Ygilany/skills`: the grilling rounds (`skills/factory-grill/grilling.md`), `to-spec` (`skills/factory-align/to-spec.md`) and `to-tickets` (`to-tickets.md`, beside this file). Read the first two where they live, in the factory's `skills/` folder (beside the `factory.yaml` that `factory --help` prints as the `--config` default; never search the disk for them), and follow each as this skill says.

**The project.** `<file>` is the manifest `factory config check --json` prints as `project`, run from this thread's working directory (the nearest `.factory/project.yaml` above it, or a contributor project's manifest in the factory checkout); `<repo>` is its `tracker.repo`, `<host>` its `tracker.host` (`github.com` without one), `<base>` its `base_branch`. Run every `factory` command with `--project-file <file> --json`. `factory --help` lists them.

**The owner reads the turn's last message.** Every post below (a round, the confirm, the breakdown, the spec's artifact, the started tickets) is written as `factory-ticket-thread`'s "The turn's last message" says: after every tool call of the turn, as its final message.

**The artifacts mode.** `factory config check` prints the project; `artifacts` in `<file>` is `tracker` (the default) or `thread`. Under `thread` this skill posts no comment on the parent and files each child with its title and approved body only: no label and no inheritance block. It files the parent with no label either, records each child's inheritance with `factory ticket inherit <child> --from <n> --project-file <file> --json` once the parent is started and its spec committed, just before starting the child, and posts the spec nowhere (`post-doc` records it).

**Acting as the project's identity.** Every issue, comment, relation and PR this skill writes on GitHub is the project's identity's, so its grilled marker counts (only the identity's or an approver's does) and the router starts nothing it files. `factory config check` names the identity (step 1). Its token command, `<token>`, is:
- a `github_app` identity `<name>`: `factory github-app token --repo <repo> --identity <name>`;
- a `gh_user` identity naming `<login>`: `gh auth token --hostname <host> --user <login>`.

Every `gh` write below is written as one command line that mints the token and goes no further without it, `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh …`, and names the host, as `factory-open-pr` §1 does: `-R <host>/<repo>` for `gh issue` and `gh pr`, `--hostname <host>` for `gh api`. Off `github.com`, write `GH_ENTERPRISE_TOKEN` where the line says `GH_TOKEN`. The token command runs without `--json` there, so it prints the bare token. A shell variable doesn't outlive its command line, so mint it on every line. A line whose token is empty runs no `gh`: plain `gh` would write as the owner, an approver, and the router would start the parent before its children exist. Report the line's error and stop.

## Steps

1. **Check the project.** Run `factory config check --project-file <file> --json`. Its `identity` says how this skill writes: go on only when `identity.routerStartsIssues` is `false` (the router starts no ticket for an issue that identity files). When it is `true` or `null`, or `identity` is null, reply `the feature front door needs the project to act as a GitHub App or a bot account the router doesn't start issues from: run setup-factory-project` and stop. Then run `t=$(<token>) && [ -n "$t" ] && echo ok`: when it prints nothing, report that and stop.

2. **Grill.** Read `skills/factory-grill/grilling.md` and grill the owner on the idea here, in its numbered rounds with a recommendation each. Facts are yours to look up in the repo, `GLOSSARY.md` and `docs/decisions/`; decisions are the owner's. When the frontier is empty, post `feature: confirm` with the shared understanding: each decision with its answer, the questions left open, the glossary terms and decision records the spec should add. Revise until the owner confirms it. Done when the owner has confirmed: file nothing before that.

3. **File the parent.** Write the issue body: what the feature delivers in two or three sentences, the acceptance criteria the grilling settled, and a line saying the spec follows as a comment. File it: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh issue create -R <host>/<repo> --title "<feature title>" --body-file <tmpfile>`, with `--label factory` added under `tracker` only; it prints the URL, whose number is `<n>`. Under `tracker`, then post the grilling's record on it: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh issue comment <n> -R <host>/<repo> --body-file <tmpfile>`, a comment headed `## Settled in grilling`, naming the approver who confirmed it (`@` and the login `gh api user --jq .login` prints without `GH_TOKEN`), "from the feature thread", each decision with its answer, the questions left open, and the terms and records for the spec. Keep the comment's URL as `<record>`. Do not start the parent yet: it enters the parent lane only if its sub-issues exist when it starts.

4. **Take the ticket's branch.** `<slug>` is the title's words, lowercased and joined by `-`, at most 40 characters; `<branch>` is `<branch_prefix><n>-<slug>`, the prefix being `branch_prefix` in `<file>` (`factory/` when it sets none, and empty gives `<n>-<slug>`). When `git rev-parse --path-format=absolute --git-dir --git-common-dir` prints the same path twice, this thread runs in the project's main checkout: call `t3_worktree_handoff` with `branch` `<branch>`, `baseRef` `<base>`, `startFromOrigin` true, and `continuationPrompt` `Continue the factory-feature skill for <repo>#<n> at step 5. Branch <branch>; grilling record <record>.` as this turn's last call. Otherwise, in this thread's own worktree with a clean `git status`, run `git fetch origin <base> && git switch -c <branch> origin/<base>`.

5. **Write the spec** with `to-spec` (`skills/factory-align/to-spec.md`): its seams step (check the seams with the owner) and its template, skipping its publishing and triage label. The doc is `docs/specs/<n>-<slug>.md`, created with its folder when missing. Its first section after the title is **`## For the owner`**, as the `to-spec` template defines it, on one screen. Its decisions section records each settled decision with "settled in grilling, `<record>`". Add the terms and records the grilling listed, as the project's `docs/agents/domain.md` says. Commit it all on `<branch>` and `git push -u origin <branch>`.

6. **Break it down** with `to-tickets` (`to-tickets.md`, beside this file): its steps 1 to 4, drafting tracer-bullet tickets with their blocking edges and quizzing the owner until they approve the breakdown; skip its step 5 (publishing: this skill files the tickets in its step 7). Keep the tickets file-disjoint where you can: parallel tickets editing the same files were the factory's commonest send-back (decision 0044). Done when the owner approved a breakdown of one ticket or more.

7. **File and start the tickets.** One approved ticket: go to "One ticket: the parent is the ticket". More than one: go to "Several tickets: a parent and its children". Each ends at step 8.

8. **Hand over to the ticket thread.** Run `factory thread plan <n> --project-file <file> --json`; with `refreshCapabilities`, refresh the snapshot as `factory-ticket-thread` says and plan again, as "Several tickets" step 6.2 does. Rename this thread to its `title` (`t3_thread_update`, `action` `rename`) and switch to its `launch.modelSelection` with `t3_thread_configure` (no threadId): the ticket thread runs on the `ticket_thread` role's model. From now on this thread is the parent's ticket thread for `<repo>#<n>` with project file `projectFile` from that output: run `factory thread next <n> --project-file <projectFile> --json` and act on it as the `factory-ticket-thread` skill says (if it isn't in your skill list, read `skills/factory-ticket-thread/SKILL.md` in the factory's checkout and follow it). A parent's `run` of `track` posts the children's progress; a one-ticket feature launches its build or waits at `spec_approval`.

Done when this thread is renamed, on the ticket thread's model, and has acted on `thread next`'s first output.

## One ticket: the parent is the ticket

The parent is the ticket, and it starts at the grill this thread ran: triage is skipped, the grilling and the spec complete as their stages, and the spec's gate resolves as the profile has it for a grilled ticket (decision 2026-10-12-the-feature-thread-files-the-tickets-before-it-starts-them). Run these in order, back to back, so the sweep never finds the ticket without its thread.

1. **Run one critic pass** on the committed spec, as `factory-align` steps 5 to 7 say (the critic from `factory route spec_critic --lane standard --author <your model> --json`, the factory's `rubrics/spec.md`, a second pass only on what you fixed, never more than `stages.align.critic_passes`). Commit and push the fixes. Keep its verdict, its passes and each pass's findings for step 6.
2. `factory ticket start <n> --from grill --project-file <file> --json`: the ticket starts in the standard lane at `grill`, `triage` skipped. A start past the first stage is an approver's, so run it with `gh` signed in as the owner (no `GH_TOKEN` set); the CLI credits it to that account.
3. `factory thread record <n> --thread <this thread's id> --branch <branch> --project-file <file> --json`. This thread's id is the `threadId` that `t3_thread_configuration` returns without one.
4. Run `factory ticket report-file <n> --project-file <file> --json` and write the grilling's record to the `path` it names, with a `## For the owner` section last (one line: the decisions settled and left open). Then `factory ticket complete <n> --evidence artifact=<record> --evidence grilled=true --evidence report=<path> --project-file <file> --json` (under `thread` there is no `<record>` URL: leave `artifact` out and the CLI records the path): the ticket is grilled and at `align`.
5. `factory ticket post-doc <n> --doc docs/specs/<n>-<slug>.md --project-file <file> --json`.
6. Record each critic pass: `factory ledger record <n> --type critique_round --data '<json>' --project-file <file> --json`, as `factory-align` step 5 says.
7. `factory ticket complete <n> --evidence doc=docs/specs/<n>-<slug>.md --evidence critic=<verdict> --evidence findings=0 --evidence rounds=<passes> --project-file <file> --json`: the spec's `spec_approval` gate passes or waits as the profile has it, never skipped.
8. Build align's artifact as `factory-ticket-thread`'s "Posting a stage's artifact" says for `align`, with the spec's posted URL as its link (its page is published now, as a tool call). Keep its text for the turn's final message: go to step 8 of Steps above, and end the turn with the artifact and what step 8's action posts, in the order "The turn's last message" gives.

The spec, terms and records reach `<base>` in the build's PR: the build works on `<branch>`.

## Several tickets: a parent and its children

1. **File each child** in dependency order, blockers first. Under `thread`, file each with its title and its `## What to build` and `## Acceptance criteria` only, with no `--label factory` and no inheritance block; its inheritance is recorded in step 6, once the parent exists in the factory. Under `tracker`: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh issue create -R <host>/<repo> --title "<ticket title>" --body-file <tmpfile> --label factory`. The body is the `to-tickets` issue template's `## What to build` and `## Acceptance criteria`, then the inheritance block `factory ticket follow-up` writes, headed `## Inherited from #<n>` with the record under `### Settled in grilling` and the grilled marker as its last line, on a line of its own (the ticket's start reads only that line; align reads the block):

   ```
   ## Inherited from #<n>

   Child of #<n>
   Spec: `docs/specs/<n>-<slug>.md` (on #<n>'s branch <branch>, and posted on #<n>)
   Settled in grilling: <record>

   ### Settled in grilling

   <the record's text without its heading>

   Grilled: inherited from #<n>
   ```

2. **Link them.** Each child becomes a sub-issue of the parent: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh api --hostname <host> -X POST repos/<repo>/issues/<n>/sub_issues -F sub_issue_id=<child's id>`. Each blocking edge goes on the child it blocks: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh api --hostname <host> -X POST repos/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker's id>`. An issue's id is `gh api --hostname <host> repos/<repo>/issues/<number> --jq .id`, not its number. Check with `factory ticket children <n> --project-file <file> --json` (every child listed) and `factory ticket blockers <child> --project-file <file> --json` for each child with edges.
3. **Start the parent and take it:** `factory ticket start <n> --project-file <file> --json` must show `lane` `parent`; then at once `factory thread record <n> --thread <this thread's id> --branch <branch> --project-file <file> --json`.
4. **Post the spec** on the parent: `factory ticket post-doc <n> --doc docs/specs/<n>-<slug>.md --project-file <file> --json`. The children's align reads it there until it merges.
5. **Land the spec.** The parent builds nothing, so no build's PR carries `<branch>`. Open one PR of it, for the owner to merge: `t=$(<token>) && [ -n "$t" ] && GH_TOKEN="$t" gh pr create -R <host>/<repo> --base <base> --head <branch> --title "<feature title>: spec" --body "<one line: the spec, glossary terms and decision records the feature thread settled for #<n>>. Part of #<n>."`. Name the parent only as `Part of #<n>`, never with a closing keyword (`Closes`, `Fixes`, `Resolves`): merging the spec leaves the parent open, tracking its children. Once it merges, the children read the spec from their own checkouts.
6. **Start each child and launch its thread**, one child at a time:
   1. Under `thread`, first `factory ticket inherit <child> --from <n> --project-file <file> --json`, run from this worktree: it reads the parent's spec, committed here as `docs/specs/<n>-<slug>.md` (a parent in the parent lane has no stage records), and must show `grilled` true. Then `factory ticket start <child> --project-file <file> --json` must show `stage` `triage` and `grilled` true: its triage takes the parent's decisions as settled.
   2. `factory thread plan <child> --project-file <file> --json`; with `refreshCapabilities`, refresh the snapshot as `factory-ticket-thread` says and plan again.
   3. Launch and record it exactly as the `factory-router` skill's `launch_ticket_thread` steps 1 to 3 say, with the plan as the effect: `t3_thread_launch`, `t3_thread_wait`, the fallbacks, then `factory thread record <child> --thread <threadId> --branch <launch.workspaceStrategy.branch> --project-file <file> --json`.
   Keep a line `started [<title>](t3-thread://v1/<threadId>)` for each, for the turn's final message, which holds them with what step 8's action posts, in the order "The turn's last message" gives. A child whose launch fails on every model is left to the sweep, which launches a thread for any started ticket with none: name it in those lines.
7. Go to step 8 of Steps above.

## When a command fails

Write the turn's final message and stop: every post the turn held back, with the command and the first line of its error below them; the owner decides from there. What is filed stays filed: a parent left unstarted is started by running the rest of these steps again from the one that failed, and a ticket started without its thread gets one from the sweep.
