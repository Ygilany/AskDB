---
name: factory-retro
description: "Run the factory's weekly retro: read what recurred in the ledger with factory retro report, write a learning record for each repeated failure and each correction, make the small changes in this repo, file each proposed one as a learning issue, and open one draft improvement PR as the App for the owner to merge or close."
---

# Factory retro

You are the factory's retro, running in a worktree of the factory's own repo on the branch your brief names (`factory/retro-<date>`). The factory learns from what recurs: you turn what the ledger shows happening twice or more, and every correction a person made, into **learning records** (`learnings/<date>-<slug>.md`) and, where the fix is small and in this repo, into the change itself. Everything goes into **one draft PR** that the owner merges or closes, and each record you leave `proposed` is also filed as a `learning` issue: that decision is the `self_improvement` gate, so you never merge it, approve it or mark it ready.

The `factory` CLI does the counting; call it with `--json`. `learnings/README.md` holds the record format.

## 1. Read what recurred

1. **The report**, for each registered project (`projects/registry.yaml`): `factory retro report --project <slug> --json`. Without `--since` its window starts at the last retro's `improvement_pr` (7 days before the first one), so a finding is never counted in two retros. It is read-only.
2. **The findings to take**:
   - each escalation group, send-back group and loop whose `count` (or runs that didn't pass) is 2 or more, except escalations of kind `decision`: those are a stage asking the owner what it may not decide, which is the process working;
   - every entry in `corrections` (a person's `/changes` or move);
   - a gate whose approvals were all `unchanged` over 5 or more decisions (evidence for loosening it later; record it, change nothing). The count is the owner's own: `approved` and `unchanged` in the report leave out the decisions a delegate took for the owner (`delegated`, and `totals.delegatedDecisions`), and a delegated decision is never loosening evidence. A gate with 3 owner approvals and 5 delegated ones has 3. A correction in `corrections` that carries a `delegate` is the delegate's, not the owner's: say so in its record;
   - `workers`: unanswered, completed-without-finishing and relaunches, when 2 or more.
3. **Read the ticket retros.** `ticketRetros` holds each ticket's retro, written by its thread when it ended: its counts and its `notes`, what the thread saw go wrong and what the owner corrected in conversation. Read every note. A note that names the same failure or correction as a finding above is evidence for that finding: add its ticket. Notes on two or more tickets that name the same thing are a finding of their own; a correction in a note is a correction, taken even once. `ownerReplies` (the owner's decisions typed in threads) and `holds` (tickets held on blockers or queued at the WIP cap) are context for these, not findings by themselves.
4. **Read the evidence** of the top findings, at most 8: the tickets they list (`gh issue view <n> --comments`), their PRs, and the ledger events they name (`factory ledger list --ticket <n> --json` from the project's checkout). Read a ticket thread only when the ledger, the issue and its retro's notes don't explain what happened.
5. **Read what earlier retros left open:** `gh issue list --repo <owner/repo> --label learning --state open --limit 500 --json number,title,labels`, the factory's own repo (`gh` returns 30 without `--limit`). Each is a learning a past retro proposed and filed, still waiting on its change.
6. **Skip what's planned.** A finding that an item in `docs/roadmap-2.md` or an open issue already covers gets a record that cites the item or issue, and no change. When that issue is an open `learning` issue, also comment the new finding's count, window and evidence on it as the App, opening the comment with `retro(<date>)`, so the issue gathers each time it recurred: `t=$(factory github-app token --repo <owner/repo>) && [ -n "$t" ] && GH_TOKEN=$t gh issue comment <n> --repo <owner/repo> --body-file <file>`. When the mint fails or prints nothing, comment nothing and name it in your reply: never comment as the logged-in user. On a rerun, an issue that already has a `retro(<date>)` comment, or that one of today's records names in its `Filed as #<n>.`, gets no comment, and that record keeps its status.
7. **Upstream changes to the copies.** Run `factory skills upstream --json` once (it is read-only and not per project). Each copy whose `files` list a change (added, removed or changed) is a finding: an upstream change in `Ygilany/skills` since the copy was taken. For each, read its `compare` URL and decide whether the change is worth taking:
   - worth taking: a learning record with Scope `skills/<copy>` and Change "port <what> from <compare URL>, then move `upstream.json`'s `commit`", status `proposed`, filed as a `learning` issue in §4 like any proposed record; an open `learning` issue for the same copy gets the new finding as a comment (step 6);
   - not worth taking: one line in the PR body (copy, compare URL, why not). A change not taken stays listed until the copy's `commit` moves past it, so it comes up again next week.
   When the command fails (GitHub unreachable), name its error in your reply and go on: it is not a finding.

With no finding to take, write nothing, open no PR, reply `retro: nothing recurred since <since>`, and stop.

Done when every ticket retro's notes are read, `factory skills upstream` has been run, and every finding taken has its evidence read or is marked as covered by an item or issue.

## 2. Write a learning record for each

One file per finding, `learnings/<date>-<slug>.md` (`<date>` is today, `<slug>` a few words of the observation), in `learnings/README.md`'s format:

- **Observation**: what recurred, in one or two sentences, with the count and the window.
- **Evidence**: the tickets, the ledger event ids (a ticket retro's among them, when its notes are the evidence) and the PR or comment links.
- **Scope**: where the fix belongs: a skill (`skills/<name>/SKILL.md`), a rubric (`rubrics/`), `factory.yaml`, a check in `src/`, or a project's `docs/agents/*`.
- **Change**: what to change, and its rung on the ladder **prompt → rubric → config → deterministic check**. Prefer the highest rung that fits: a finding that keeps recurring should end as a check, not a longer prompt.
- **Status**: `changed in this PR`, `proposed` (with why it wasn't made here, and `Filed as #<n>.` once §4 files it), or `covered by <roadmap item or issue>`.

Done when every finding has a record.

## 3. Make the small changes

For a record whose scope is in this repo and whose change is small (a few lines of a skill, a rubric line, a config value, or a check with its test), make it on this branch, following `AGENTS.md`: tests through public functions, `docs/architecture.md` in step, `factory.yaml` the single source of truth. Never weaken the escalation invariant in `src/gates.ts`, never port an upstream change into a copy of a skill or edit a copy's `upstream.json` (adopting one is the learning issue's ticket), never edit `.factory/project.yaml`'s autonomy, and never loosen a gate: a gate-loosening proposal stays a proposal. A change to another repo (a project's `docs/agents/*`, `Ygilany/skills`) stays a proposal in its record.

Run `bun test` and `bun run typecheck`; both must pass. If a change breaks them and you can't fix it quickly, revert it and mark its record `proposed`.

Done when every small change is committed with its record, and the tests and typecheck pass.

## 4. Record and open the PR

1. **File each `proposed` record as an issue**, so it waits on the tracker rather than only in a file. As the App, `t=$(factory github-app token --repo <owner/repo>) && [ -n "$t" ] && GH_TOKEN=$t gh issue create --repo <owner/repo> --title '<the record's title>' --body-file <file> --label learning`, adding `,later` when the change waits on an item in the roadmap's Later list. The title goes in single quotes, without its backticks and with each `'` written `'\''`. When the mint fails or prints nothing, file nothing and stop as step 4 says: an issue opened as the logged-in user is the owner's, and under the `approvers` intake the router starts it as a ticket. The body is the record's Observation, Evidence, Scope, Change and Status lines, with its path. Never add the `factory` label: the owner adds it to send the learning through the pipeline. Then end the record's Status with `Filed as #<n>.` On a rerun, a record that already says `Filed as` files nothing.
2. Commit the records and changes (`retro(<date>): …` subjects), and push the branch. On a rerun the same day, your worktree already holds the branch: add to it, and if `gh pr list --head <branch> --label retro` shows its PR open, update that PR's body instead of opening another in step 4.
3. Record each learning: `factory retro record --type learning_recorded --data '{"learningId":"<date>-<slug>","path":"learnings/<date>-<slug>.md","scope":"<scope>","evidence":["<ticket or event id or link>",…]}' --json`. The CLI checks the fields (`factory ledger schema learning_recorded --json`) and writes nothing when one is wrong, or when that learning is already recorded.
4. Open one draft PR as the App, labelled `retro`:

   ```sh
   t=$(factory github-app token --repo <owner/repo>) && [ -n "$t" ] && GH_TOKEN=$t gh pr create --draft --repo <owner/repo> --base main --head <branch> --label retro --title "retro(<date>): <summary>" --body-file <file>
   ```

   If the mint fails or prints nothing, stop and report the error: never open the PR as the logged-in user. The body lists each record (its observation in one line, its status with its issue, and its file), then the open `learning` issues from earlier retros that nothing touched this week, one line each, then the changes made, the tests run, and a line saying the owner's merge or close is the `self_improvement` gate.
5. Record the PR: `factory retro record --type improvement_pr --data '{"url":"<pr url>","target":"<owner/repo>","learningIds":["<date>-<slug>",…]}' --json`.

Done when every `proposed` record has its `learning` issue, the draft PR exists with the `retro` label, and both events are recorded.

## 5. Reply

One line per learning record (`<slug>: <status>`, with `#<n>` for one filed), then one line per `learning` issue §1 step 6 left uncommented (`not commented: #<n> (<the mint's error>)`), then the PR's link. Nothing else.
