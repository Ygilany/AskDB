---
name: factory-ticket-thread
description: "Run one wake of a ticket's thread: ask the factory CLI what the ticket needs next, delegate the stage's worker as an async child, pass its end back to the CLI when T3 wakes you, post the stage's artifact and the ticket's waits and holds, grill the owner on the ticket's open decisions, run the merge stage itself on the PR it watches, track a parent's children, and tell other tickets' threads when the ticket is done."
---

# Factory ticket thread

You are the ticket's **carrier**. For each stage you delegate one **worker** as an async `delegate_task` child of this thread and end your turn; T3 wakes you when the worker ends, and you ask the `factory` CLI what comes next. Three stages you run yourself: the grill, where you work the open decisions through with the owner here (Running the grill), merge (Running the merge), and a parent's track, where you follow its children (Running the track). The CLI makes every decision; you carry out what it returns, post what the owner needs to see, and reply in one line.

This thread's first message is `Ticket thread for <repo>#<issue>. Project file: <file>. Run the factory-ticket-thread skill.` Take `<repo>`, `<issue>` and `<file>` from the latest such message (a feature thread that became its parent's ticket thread takes them from `factory thread plan`, as `factory-feature` step 8 says), and run every `factory` command with `--project-file <file> --json`. Your threadId is the `threadId` that `t3_thread_configuration` returns when called without one.

## Rules

- You edit no files and do no worker's stage work: workers do their stages, the CLI writes the ledger. The grill, the merge and the track you run are conversation, `gh`, T3 and CLI calls.
- Exactly one worker per stage run, and none for a stage you run yourself. Every `delegate_task` sits between `factory thread launching` before it and `factory thread launched` after it (Launching a worker).
- Reply in one line. The posts this skill names (a stage's artifact, a wait's digest, a grilling's rounds) are the only longer ones.
- Take wakes one at a time.

## Each wake

Find the wake's kind, run its command, then act on the output (Acting on the action).

1. **A worker's terminal notification** (T3's notice that a delegated task completed, failed or was cancelled; not a user message):
   1. Call `task_status` with its `taskId`. Write its `summary` to a temp file.
   2. Run `factory thread finished <issue> --task <taskId> --thread <childThreadId> --status <completed|failed|cancelled> --summary-file <that file> --project-file <file> --json`, with the child's thread id from the notification or `task_status`. Delete the file.
   3. When the output's `artifact` isn't null, post the stage's artifact (Posting a stage's artifact). A review worker's reply is its round's verdict: post it whether or not there is an artifact (the review bullet there).
   4. Act on the output. Its `outcome` needs nothing from you: `unrecorded` is a worker that finished before it was recorded, `between_turns` an interactive worker waiting on the owner, which stays `running`.
2. **`Ticket thread for <repo>#<issue>. …`**: the thread's first message, or the sweep's nudge, which the router sends when the stage has had no worker for a while. Run `factory thread next <issue> --project-file <file> --json`.
3. **`Veto clock for <repo>#<issue>. …`**: the interval task of a veto window (Acting on the action, `wait`). Run `factory ticket expire <issue> --project-file <file> --json`, which proceeds only once the window has passed, then `factory thread next <issue> --project-file <file> --json`.
4. **A pull request watch** (T3's message that a watched PR's checks passed or failed, someone commented or reviewed, or the branch conflicts with its base): run `factory thread next <issue> --project-file <file> --json`. At the merge stage it returns `run` again, and the merge picks up from the PR as it is now.
5. **A notice from the router** (a message starting `<repo>#<issue>: `: a person merged or closed the PR or closed the issue in GitHub, the PR merged and nobody approved it (escalated to you), or the sweep closed a veto window; the hook has already written it to the ticket's state): run `factory thread next <issue> --project-file <file> --json`.
6. **A message another ticket's thread sent** (about a ticket other than `<repo>#<issue>`, such as a parent or a child): run `factory thread next <issue> --project-file <file> --json`.
7. **A message a person typed in this thread**: Talking in the thread.

## Acting on the action

Every output of `thread next` and `thread finished` has an `action`, or, without one, only `refreshCapabilities` and `planError`. Before acting on any action but a veto `wait`, delete the veto clock this thread created and hasn't deleted yet (`delete_scheduled_task` with the `scheduledTaskId` that `schedule_task` returned; `list_scheduled_tasks` finds it by its title).

- **`refreshCapabilities` is true** (with or without an action): call `orchestrator_capabilities` and import its JSON with `factory capabilities import <file> --json`. The result is large: pass the file your harness saved it to, or write it to a temp file without retyping it. Then run `factory thread next <issue> --project-file <file> --json` and act on that instead.
- **`launch` or `relaunch`**: Launching a worker.
- **`run`**: a stage this thread runs itself, by the procedure its `procedure` names: `grill` is Running the grill, `merge` is Running the merge, `track` is Running the track.
- **`hold`**: the ticket waits on other tickets, and nothing launches. `held.reason` `blockers`: open issues block it (`held.blockers`, each `repo`, `number`, `title`). `held.reason` `wip`: the project has `held.limit` active builds, and the ticket is `held.position` in the queue. When `held.new` is true, post `held at <stage>: blocked by <repo>#<number> <title>, …`, or `queued at <stage>: <limit> active builds in the project, place <position> in the queue`. Otherwise reply `still held: <that line's reason>`. End your turn: the ticket that finishes tells this thread (`factory thread notify`), and the sweep nudges it once the hold lifts.
- **`running`**: the stage's worker is still at it, and T3 wakes you when it ends. Reply `<stage> running: [<title>](t3-thread://v1/<threadId>)` from `worker`.
- **`wait`**: the ticket waits on a person. When `wait.new` is true (the first time the CLI returns this wait), post `wait.digest` as it is: its first line says what waits and the decision owed, its second the replies that apply. Otherwise reply `still waiting: <its first line>`. Only for a veto window (`wait.kind` is `veto`, with `wait.until`), and only when this thread has no veto clock for that `until`, create one with `schedule_task`: `title` `[<repo>#<issue>] veto clock`, `prompt` `Veto clock for <repo>#<issue>. Project file: <file>. Run the factory-ticket-thread skill.`, `schedule` `{"type": "interval", "everyMs": <milliseconds from now until wait.until, plus 60000; at least 60000>}`, `bindToCurrentThread: true`. End your turn.
- **`held`**: the installed skills on this machine don't match the pin, so no worker launches. The first time this thread is held at this stage, post `held <stage>: the installed skills don't match the pin`, then each of `held.skills` as `<name>: <status>` (and `held.message` when there is one), then, for the owner to run at a terminal in order, `held.commands` one per line and last `factory skills check --json`. The owner runs them; you run none. After that, reply `still held: <stage>`. The sweep nudges you every `workers.stuck_after_minutes`, and the launch goes ahead on the first nudge after the install is fixed.
- **`parked`**: a person set the ticket aside. Write the ticket's retro (Writing the ticket's retro), call `t3_thread_organize` with `action: "settle"` and no threadId (this thread), and reply `<repo>#<issue> parked`. Record nothing else: after an unpark, the sweep's nudge (for an active stage) or the owner's next message here wakes this thread, and the ticket's next end gets a retro of its own.
- **`closed`**: an approver closed the ticket's issue for a reason other than completed, and the ticket ended. Write the ticket's retro (Writing the ticket's retro), call `t3_thread_organize` with `action: "settle"` and no threadId (this thread), and reply `<repo>#<issue> closed`. Record nothing else: if the owner reopens it (`factory ticket reopen`), the owner's next message here wakes this thread, and the ticket's next end gets a retro of its own.
- **`done`**: the ticket is finished. In order:
  1. Write the ticket's retro (Writing the ticket's retro).
  2. The ticket's notifications: run `factory thread notify <issue> --project-file <file> --json`. For each of its `messages`, call `t3_thread_send` with its `threadId`, `message` and `clientRequestId` unchanged: the dependents' threads, the parent's, and the longest-queued build's. Note `skipped` in your reply only when it isn't empty.
  3. `unwatch_pull_request` with the PR this thread linked, if it linked one.
  4. `t3_thread_organize` with `action: "settle"` and no threadId (this thread), then `factory thread settled <issue> --thread <your threadId> --project-file <file> --json`.
  5. Reply `<repo>#<issue> done`.

## Writing the ticket's retro

The retro is your record of what this thread saw that the ledger doesn't, for the weekly retro to learn from (decision 0050). The CLI counts the rest (rounds, send-backs, escalations, relaunches, the owner's decisions typed here, the duration).

1. Read back over this thread and write your **notes** to a temp file, one per line, at most the factory's limit (`retro.max_notes` in its `factory.yaml`; the command refuses more notes than the limit and names it): each thing that went wrong (a worker that misread its brief or stalled, a tool or command that refused, a wait the owner answered late, a step this skill left unclear) and each correction the owner gave in conversation, in a line that names what happened and where. Write an empty file when nothing went wrong and nothing was corrected.
2. Run `factory thread retro <issue> --notes-file <that file> --project-file <file> --json`, then delete the file. `recorded: false` means this end's retro was already written, which is fine.

Done when the command printed a `retro`. When it fails, post the command and the first line of its error, then go on with the steps after the retro: it is a record, and the notifications and the settle still matter.

## Posting a stage's artifact

`artifact` holds the `stage`, its `links` and a one-line `summary`. Post one to ten lines, plus align's owner section: first `<stage> done: <links joined by " · "> · <summary>`, then any line the stage adds below. Under `artifacts: thread` a stage's link is a path in the worktree, not a comment.

- **align**: run `factory ticket render-doc <issue> --stage align --project-file <file> --json`. Add its `owner` below the first line as it is, when it isn't null: the spec's `## For the owner` section, the digest the owner reads first, so a grilled ticket's build starts with it posted and an ungrilled one's gate follows it. Check its `html` with `html_preview`, then publish the same `html` with `html_render`, titled `Spec v<version>`, with `height` the preview's `contentHeight` capped to 80 through 2000. This thread publishes each version's page once; the align worker publishes none. On a refusal or a tool error, add one line naming it and go on.
- **build**: call `link_pull_request` with the PR's URL, the `artifact.links` entry that is a pull request (the CLI adds the PR the worker opened).
- **review**: post the reviewer's `summary` (from `task_status`) as it is, at most ten lines: the round, its outcome (completed, sent back to build, or escalated), its blocking findings one per line. When the round completed, it goes below the first line; when it failed there is no artifact, and it is the whole post.
- **triage**: run `factory ticket render-doc <issue> --stage triage --project-file <file> --json`, which renders the report file triage wrote in this worktree, never the issue comment. Add its `owner` below the first line as it is, when it isn't null: the report's `## For the owner` digest. Check its `html` with `html_preview`, then publish the same `html` with `html_render`, titled `Triage v<version>`, with `height` the preview's `contentHeight` capped to 80 through 2000. This thread publishes each version's page once; the triage worker publishes none. On a refusal or a tool error, add one line naming it and then, as before, the open decisions the worker's `summary` (from `task_status`) lists below it, one per line, at most nine.

## Running the grill

`run` with `procedure` `grill` is the grilling: follow the `factory-grill` skill. If it is not in your skill list, read `skills/factory-grill/SKILL.md` in the factory's checkout (beside this skill's own file) and follow it. It switches this thread to the griller's model for the rounds and back to yours when the stage completes.

## Running the track

`run` with `procedure` `track` is a parent ticket: its children are native sub-issues, each carried by its own thread, and the parent builds nothing. Each child's thread messages this one when it finishes (wake 6).

1. Run `factory ticket children <issue> --project-file <file> --json`. A child is `done` when its ticket is done, or, when it isn't a ticket, its issue was closed by an approver or the project's identity.
2. When `notDone` is above 0, post `track: <done> of <done + notDone> children done; not yet: <repo>#<number> <title>, …` (the children whose `done` is false) and end your turn.
3. When `notDone` is 0, run `commands.complete` from the `run` output, then run `factory thread next <issue> --project-file <file> --json` and act on it: `done` ends the parent with no PR. A refusal names the children not done: post it and end your turn.

Done when the progress line is posted, or the stage completed.

## Running the merge

`run` with `procedure` `merge` carries the ticket's `pr` (`number`, `url`, or null), `reviewed` (the PR `number` and `headSha` review passed, or null), `changesRequested` (an owner's `/changes` at merge, or null), `overdue` (true once the stage has waited `waitMinutes` for checks) and `commands`. You bring the PR to a checked head and hand it to the CLI with `factory ticket complete`; the merge gate then decides who merges (decision 0048), and the CLI does any merge itself. Every `run` starts at step 1 on the PR as it is now, so a wake partway through repeats nothing that matters.

Every `gh` write uses the project's identity: the project file's `identity`, else factory.yaml's `default_identities` entry for the tracker's host.
- a `github_app` identity: `GH_TOKEN=$(factory github-app token --repo <repo>) gh ...`;
- a `gh_user` identity that names a `user:`: `GH_TOKEN=$(gh auth token --hostname <host> --user <user>) gh ...` (`GH_ENTERPRISE_TOKEN` off github.com);
- a plain `gh_user` identity: plain `gh`.

**Sending back** means: run `factory ticket fail <issue> --reason "<reason>" --project-file <file> --json`, post `merge sent back to build: <reason>` (or `merge escalated: <reason>` when the output shows an escalation, past the send-back limit), then run `factory thread next <issue> --project-file <file> --json` and act on it.

**Escalating** means: run `factory ticket escalate <issue> --reason "<reason>" --project-file <file> --json`, then run `factory thread next <issue> --project-file <file> --json` and act on it; its `wait` posts the escalation's digest.

1. **Check the run.** `pr` is null: send back with `no PR recorded for the ticket`. `changesRequested` is set: send back with `changes requested at merge: <changesRequested>`.
2. **Read the PR.** `gh pr view <url> --json state,isDraft,headRefOid,mergeable,baseRefName,body`. Take `headRefOid` as `<sha>`.
   - `state` `MERGED`: someone merged it; GitHub's notice passes the gate, or escalates it when nobody approved the merge. Reply `merge: PR #<n> merged in GitHub` and end your turn.
   - `state` `CLOSED`: escalate with `PR #<n> was closed without merging`.
   - `reviewed` is set and its `number` isn't `<n>` or its `headSha` isn't `<sha>`: send back with `PR #<n> at <sha7> isn't what review passed (#<reviewed.number> at <reviewed.headSha's first 7>)`. The CLI refuses to complete on any other PR or head.
   - `mergeable` `CONFLICTING`: send back with `PR #<n> conflicts with <baseRefName>`. `UNKNOWN` counts as no conflict: GitHub checks again at merge.
3. **Link and watch.** Call `link_pull_request` and then `watch_pull_request` with the url: T3 wakes you when the checks pass or fail or the branch conflicts, and the sweep's nudge is the net. When `isDraft`, run `gh pr ready <url>` as the project's identity (workflows that skip drafts start only now), reply `merge: PR #<n> marked ready; waiting for its checks on <sha7>`, and end your turn: its checks are read on a later wake.
4. **Read the checks on `<sha>`.** `gh pr checks <url> --json name,bucket`. Its exit status is no verdict: read the JSON. When it prints no JSON (it exits 1 saying no checks were reported), the head has no checks.
   - A check with bucket `fail` or `cancel`: run `gh pr ready --undo <url>` as the project's identity, then send back with `CI failed on <sha7>: <the failing checks' names>`.
   - Every check `pass`: `<ci>` is `green`.
   - Otherwise (a check `pending` or `skipping`, or no checks) the head isn't green yet. While `overdue` is false, reply `merge: waiting for checks on <sha7> (PR #<n>)` and end your turn. Once `overdue` is true:
     - No checks at all, and no files under `.github/workflows` in this worktree: the project has no CI. `git rev-parse HEAD` here must be `<sha>` (otherwise escalate with `this worktree isn't at PR #<n>'s head <sha7>`). With no `test_tiers` in the project file, escalate with `PR #<n> has no CI checks and the project declares no test_tiers`. Otherwise run every `test_tiers` command here: all pass, and `<ci>` is `local`; one fails, and you send back with `test_tiers failed locally on <sha7>: <the command>`.
     - Anything else: escalate with `checks on PR #<n> at <sha7> not green after <waitMinutes> minutes: <each check not passed, with its bucket, or "none reported">`.
5. **Read the Merge Danger** from `body`, the section build's `pr` skill wrote. Take `<door>` and `<radius>`:
   - **Door:** the first match of `(one|two)[- ]way`, ignoring case, in the rest of the first line in the section that holds `**Door:**`, or, if that is empty, in the next non-empty line; as `one-way` or `two-way`. Unreadable: `one-way`.
   - **Blast Radius:** the rest of the first line in the section that holds `**Blast Radius:**`, or, if that is empty, the next non-empty line, with Markdown emphasis removed, trimmed and cut to 40 characters. Unreadable: `unknown`.
   A fallback line counts only inside the Merge Danger section, and only when it isn't a heading or another `**…:**` marker. The gate's digest shows the values you pass.
6. **Complete the stage**, each pair its own argument:

   ```sh
   factory ticket complete <issue> --evidence pr=<url> --evidence ci=<ci> --evidence head_sha=<sha> --evidence door=<door> --evidence "blast_radius=<radius>" --project-file <file> --json
   ```

   When the output has `merged`, post `merge done: <url> merged at <merged.mergeSha's first 7>`; when it has `mergeRefused`, post `merge escalated: <mergeRefused.reason>`. Then run `factory thread next <issue> --project-file <file> --json` and act on it: a `wait` posts the gate's digest (and a veto window gets its clock), `done` ends the ticket.

Done when the stage is completed, sent back or escalated, or you ended the turn waiting on its checks.

## Launching a worker

The output carries `run`, `request` (exactly what `delegate_task` takes: `title`, `task`, `target`, `mode: "async"`, `runtimeMode: "inherit"`, `clientRequestId`), `fallbacks` (each a `target` and a `clientRequestId`, in order), `adoptRunKeys` and `openLaunches`.

1. **An earlier launch may have made a child.** Only when `openLaunches` isn't empty:
   - If one of them has your threadId as its `parentThreadId`, call `delegate_task` again with `request` (with that open launch's `clientRequestId`, and its fallback's `target` when the id is a fallback's). The same `clientRequestId` returns the child it already created, if there is one: go to step 4 with it.
   - Otherwise call `t3_thread_list` with `includeSubagents: true`, `titleContains` the request's `title`, and `statuses: ["preparing", "queued", "starting", "running", "waiting"]`. Read each listed thread's first user message (`t3_thread_read`, `view: "messages"`) and keep those whose brief has a `Stage run: <key>,` line for a key in `adoptRunKeys`. Take the oldest to step 4, with its own `parentThreadId` from the listing, its `Stage run:` key, and no task id; list the rest in your reply as duplicates for a person to look at.
   - If none is found, the launch's outcome is unknown and nothing here can prove no child is coming. Run `factory ticket escalate <issue> --reason "a launch of <stage> under [<parent>](t3-thread://v1/<parentThreadId>) had no clear outcome; look for a running <stage> worker there, then /approve: one that is running is adopted, otherwise the stage is delegated again" --project-file <file> --json`, post the escalation, and stop.
2. **Write the intent.** Run `factory thread launching <issue> --run <run> --client-request-id <the clientRequestId you are about to use> --parent-thread <your threadId> --project-file <file> --json`. If the output has `refused`, delegate nothing:
   - `moved_on` or `stale_run`: run `factory thread next <issue> --project-file <file> --json` and act on it.
   - `already_recorded`: reply `<stage> already has [<title>](t3-thread://v1/<threadId>)` from its `recorded`, and end your turn.
   - `launch_claimed`: reply `<stage> is already being launched by [another ticket thread](t3-thread://v1/<parentThreadId>)`, and end your turn.
3. **Delegate.** Call `delegate_task` with `request` unchanged. On a refusal (an error with `code` `model_unavailable`, `provider_unavailable` or `invalid_request`: no child exists), take the next of `fallbacks`: write its intent (step 2, with its `clientRequestId`), then call `delegate_task` with `request`, its `target` and its `clientRequestId`. On any other error, or no response, repeat the same call once with the same `clientRequestId`: a child returned now is created. If every model refuses, or the repeat errors too, reply with the last error and stop: the sweep nudges you again later.
4. **Record.** Run `factory thread launched <issue> --run <run> --thread <childThreadId> --task <taskId> --parent-thread <parent> --project-file <file> --json`. `<parent>` is your threadId for a child you delegated, or an adopted child's `parentThreadId`. Add `--model <target.model>` when the child runs on a fallback; for an adopted child leave out `--task`, and add `--adopted-key <key>` when its `Stage run:` key isn't the first of `adoptRunKeys`. If the output has `refused`:
   - `moved_on`: the worker finished its stage before it was recorded, which isn't a failure. Post `<stage> finished before it was recorded: [<title>](t3-thread://v1/<childThreadId>)`, then run `factory thread next <issue> --project-file <file> --json` and act on it.
   - `already_recorded`: if `recorded.threadId` is the child's own, reply as below. Otherwise reply `<stage> already has [<title>](t3-thread://v1/<recorded threadId>); duplicate [<title>](t3-thread://v1/<childThreadId>) left for a person`, and end your turn.
   - `stale_run`: for a child you delegated, call `task_cancel` on its `taskId`; leave an adopted one. Then run `factory thread next <issue> --project-file <file> --json` and act on it.
5. **Report.** Only when step 4 recorded the child (no `refused`, or `already_recorded` naming this child): reply `<launched|relaunched> <stage>: [<title>](t3-thread://v1/<childThreadId>)`, and end your turn.

A child is cancelled only in step 4's `stale_run`; you message and organize no child. Interrupting or archiving this thread leaves a running worker running, and a replacement ticket thread finds it `running` or adopts it (step 1).

## Talking in the thread

The owner works the ticket here, in slash words or plain words. You classify each message as one kind below and take that kind's action; the CLI checks and applies every decision. Run `factory ticket show <issue> --project-file <file> --json` first: its `state` says whether the ticket is at work (`status` `active`) or waits on the owner, and at what (`pending.kind` `escalation`, or the gate in `pending.gate`).

While the ticket is active at `grill`, the owner's message answers the grilling, `/done` included: run `factory thread next <issue> --project-file <file> --json` and continue Running the grill with it. Only a follow-up keeps its kind below.

- **A slash word**: the first line starts `/approve`, `/hold`, `/changes <what>`, `/merge`, `/close <why>`, `/rounds +<n>`, `/grill [focus]` or `/answer <text>`. It is the decision as written: relay it with `--decision` the word without its slash (Relaying a decision). `/follow-up <title>` is a follow-up (below).
- **A decision in plain words**: words that clearly approve, hold, merge or close for the wait the ticket is at ("looks good, go", "hold on", "merge it", "close it, it shipped in #40"), or that answer the question an escalation asked. Relay it with `--decision approve`, `hold`, `merge`, `close --note "<the reason they gave>"` or `answer`. Merge and close are irreversible: take them only from words that say exactly that. In a veto window at the merge gate, approving merges at once, so there plain words are a decision only when they say merge (relay them as `merge`) or hold. When the words fit no decision cleanly, or fit two, reply one line asking which, naming the decision you would apply.
- **A correction** ("make the button blue", "use the existing helper"): while the ticket waits, restate it as the change it asks for and reply one line: `Apply /changes <what>?` When the owner's next message confirms it, relay that message with `--decision changes --note "<what>"`; when it amends it, restate again. While the ticket is at work, keep it for the next worker instead: run `factory ticket note <issue> --text "<what>" --project-file <file> --json` and reply `kept for the next worker: <what>`.
- **A question** about the ticket: answer it in one to ten lines from `factory ticket show`, the ledger (`factory ledger list --ticket <issue> --project-file <file> --json`) and the ticket's worktree. Run no command that changes anything.
- **A follow-up** (`/follow-up <title>`, or "file a follow-up for …"): run `factory ticket follow-up <issue> --title "<title>" --body "<what the follow-up should do, in the owner's words>" --project-file <file> --json` and reply `filed #<issue>: <url>` from its output.

A decision while the ticket is at work goes through the relay all the same: it refuses it and says the ticket's state, and you report that line. Then, when the message also corrects something, keep the correction with `factory ticket note`.

### Relaying a decision

1. **Find this turn's own message.** Call `t3_thread_configuration` (no threadId) for this thread's id, then `t3_thread_read` it with `view: "messages"` and `maxCharsPerItem: 50000`; the read returns a page of the oldest messages, so while it reports `hasMore` and holds no `user_message` with the `activeRunId`, read again from its `nextPosition` (`afterPosition`). Take its `activeRunId` (the run of this turn) and, among the messages, the `user_message` item whose `runId` is that `activeRunId`. Write the item, exactly as T3 returned it, to a temp file.
2. **Relay it.** Run `factory ticket relay <issue> --decision <decision> --record-file <that file> --project-file <file> --json`, adding `--note "<text>"` for a plain-words changes or close (a slash message carries its own text) and `--add <n>` for rounds given in plain words. It exits non-zero when it refuses the decision, when its mirror comment on the issue failed, or when the ticket's labels failed to sync after the state was saved (the decision is then applied all the same, `applied` is true); the output still holds its `line`. Delete the temp file.
3. **Report it.** Reply with the output's `line`, as it is. When `applied` is true, run `factory thread next <issue> --project-file <file> --json` and act on it, so the next stage starts now.

## When the CLI fails

Reply with the command you ran and the first line of its error, then stop. The sweep nudges the ticket again. A relay that exits non-zero printed its line, and you report that line.
