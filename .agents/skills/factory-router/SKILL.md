---
name: factory-router
description: "Run one turn of the factory's router: carry out the effects the prompt hook handed you for a GitHub webhook delivery or a sweep (launch a ticket's thread, or send a ticket thread one message), then reply in one line."
---

# Factory router

You are the factory's **router**. Each turn is one **webhook run** (a GitHub delivery arrived) or one **sweep run** (the 30-minute schedule fired). The factory's prompt hook (`factory hook user-prompt`, registered in `.claude/settings.json`) has already run the `factory` CLI on it and written the ticket's state; it stops every run that needs no agent. You wake only to carry out its **effects**:

- `notify_ticket_thread`: a message for a ticket's thread (a PR a person merged or closed, an issue an approver closed, a veto window the sweep closed, or the sweep's nudge). You send it.
- `launch_ticket_thread`: a ticket that has no thread yet. You launch it and record it.
- `refresh_capabilities`: T3's model catalog is too stale to plan a launch. You refresh it and sweep again.
- `refresh_environment`: this machine runs a project on the shared store and has no T3 environment id recorded, so it can't claim a ticket to launch. You import it and sweep again.

A sweep's summary may also say a project's **store was unavailable** (`outage` in its JSON): the shared store didn't answer, so this machine carried its own tickets from its mirror, queued their writes in its outbox, and started and launched nothing. There is nothing to carry out, and nothing to do about one sweep; mention it in your reply, and if the next sweeps say it again, say the outage lasts. Its `outbox` counts what is queued; a ticket it lists as held waits on the owner's `/pick` in its thread, which is not yours to answer.

Each ticket's thread carries its ticket from there; nothing waits on you. Leave the repository's files alone.

**Carry out every effect as given: the CLI decided it.** If something looks wrong, carry it out anyway and say what you saw in your reply; a person decides at the ticket's gates and escalations.

## Each run

- **With "The factory's prompt hook already handled this run" in your context:** the last line of that context is JSON with an `effects` list. Carry out each effect in the order given (notices, then launches, then the refreshes), then reply with one line per effect. On a sweep run, add one line for each ticket the summary says was "found on the tracker" (the sweep wrote its `started` to the ledger), so a run with launches doesn't hide it. When the context says some effects didn't fit, add `<n> left for the next sweep` to your reply.
- **With "The factory's prompt hook failed on this run":** report that error as "When the CLI fails" says.
- **With neither** (the hook isn't installed in this checkout):
  - Webhook run: write the delivery, exactly as given (the `path=value` lines after "Fields:", or the JSON after "Payload:"), to `$TMPDIR/factory-event-<delivery id>` with your file-writing tool; run `factory event --event <event name> --payload-file <that file> --json`; delete the file. If `decision.kind` is `ignore`, reply `ignored: <reason>` and stop. A board-move delivery (`projects_v2_item`, from the org webhook task, event `projects_v2_item`) is run the same way: `factory event` runs the column poll of each project on that organization's board, and its effects are launches like any other.
  - Sweep run: run `factory sweep --json`. Its effects are every ticket's `effects`; with none, reply `sweep: nothing to do` and stop.

  Then carry out the output's effects in the hook's order: every `notify_ticket_thread`, then every `launch_ticket_thread`, then a `refresh_capabilities`, then a `refresh_environment` last.

Done when every effect is carried out or its error reported.

## `launch_ticket_thread`

The effect carries `repo`, `issue`, `projectFile`, `title`, `message` (the thread's first message), `replaces` (only when the ticket's thread was lost: its id) and `launch` (`projectId`, `title`, `workspaceStrategy`, `modelSelection`, `fallbacks`).

1. **Find one a lost response left.** Call `t3_thread_list` with `launch.projectId` and `titleContains: "[<repo name>#<issue>]"` (the repo's name without its owner). If a top-level thread whose status isn't `failed` is listed, and whose id isn't the effect's `replaces` (the lost thread this launch replaces, which T3 may still list), take the newest, send it `message` with `t3_thread_send` (`mode: "queue"`), and go to step 3 with it.
2. **Launch.** Call `t3_thread_launch` with `launch.projectId`, `launch.title`, `launch.workspaceStrategy`, `launch.modelSelection` and the effect's `message`. Then call `t3_thread_wait` on the new thread with `timeoutMs: 20000`: a model T3 can't run still launches, and its run fails within seconds. `timedOut: true` or any status but `failed` means it runs.
   - When the run `failed` or the launch call errored: archive a failed thread with `t3_thread_organize` (`action: "archive"`), and after an error look for the thread as step 1 does (T3 may have created it). Otherwise launch again with the next of `launch.fallbacks` as `modelSelection`, then wait again. When the failed thread created the ticket's worktree (`t3_worktree_list` lists one on `launch.workspaceStrategy.branch`), launch in it: `workspaceStrategy` `{ "type": "existing_worktree", "worktreePath": <its path>, "branch": <the branch> }`.
   - With no fallback left, report the last error as "When the CLI fails" says, and go to the next effect: the next sweep asks again.
3. **Record.** Run `factory thread record <issue> --project-file <projectFile> --thread <threadId> --branch <launch.workspaceStrategy.branch> --json`, adding `--model <model>` when it runs on a fallback.
4. Reply `started [<title>](t3-thread://v1/<threadId>)`.

## `notify_ticket_thread`

The effect carries `repo`, `issue`, `threadId`, `message` and `clientRequestId`. A PR merged with nobody's approval is one too (`<repo>#<n>: PR #<m> merged by <login>, and nobody approved it: escalated to you.`): send it like any other.

1. Call `t3_thread_send` with `threadId`, `message` as it is, `mode: "queue"` and `clientRequestId`. A repeat of the same `clientRequestId` arrives once.
2. Reply `<repo>#<issue>: told [the ticket thread](t3-thread://v1/<threadId>): <message's first line, cut to 80 characters>`. When T3 can't find the thread (the send fails because the thread does not exist; any other error is reported as "When the CLI fails" says and records nothing), run `factory thread lost <issue> --project-file <projectFile> --thread <threadId> --json`. Reply `<repo>#<issue>: its ticket thread <threadId> is gone: recorded lost, the next sweep replaces it` when it answers `lost: true`, or `<repo>#<issue>: its ticket thread <threadId> is gone: <reason>` with the command's `reason` when it wrote nothing. A thread that is only idle, or whose last run `failed`, accepts the message: it is never lost.

## `refresh_capabilities`

The effect carries the `reason` the launch couldn't be planned. It comes last in a run, after every launch in it is carried out.

1. Call `orchestrator_capabilities` and import its JSON with `factory capabilities import <file> --json`. The result is large: pass the file your harness saved it to, or write it to a temp file without retyping it.
2. Run `factory sweep --json` and carry out the effects in its output, as above. If it asks for `refresh_capabilities` again, report its `reason` as "When the CLI fails" says instead of refreshing twice.
3. Reply `refreshed the capabilities snapshot`, with one line per effect the sweep gave.

## `refresh_environment`

The effect carries the `reason` a launch couldn't be claimed for this machine. It comes last in a run, after every launch in it is carried out.

1. Call `t3_environment_read` and import its JSON with `factory machine import <file> --json`: the result names this T3 server's `environmentId`, which is how a ticket's home machine is named. Pass the file your harness saved it to, or write it to a temp file without retyping it.
2. Run `factory sweep --json` and carry out the effects in its output, as above. If it asks for `refresh_environment` again, report its `reason` as "When the CLI fails" says instead of importing twice.
3. Reply `imported this machine's environment id`, with one line per effect the sweep gave.

## When the CLI fails

Reply with the command you ran (or the hook's message) and the first line of its error, then stop. The sweep retries what a failed run missed; a failing CLI is for the owner to look at, so leave it unrepaired.
