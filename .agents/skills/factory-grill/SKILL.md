---
name: factory-grill
description: "The ticket thread's procedure for the grill stage: switch this thread to the griller's model, work the ticket's open decisions through with the owner here in numbered rounds, confirm the shared understanding (or take their decline), post a Settled in grilling record on the issue, complete the stage and switch the model back."
---

# Factory grill

The grill is a stage the **ticket thread** runs itself (`run_by: thread`): no worker, and the owner answers here, in this thread. You reach this procedure from `factory-ticket-thread` when `factory thread next` returns `run` with `procedure` `grill`, or when the owner answers a round while the ticket is active at `grill` (decision 0043). Keep `<repo>`, `<issue>` and `<file>` from that skill, and run every `factory` command with `--project-file <file> --json`.

The `run` output carries what you need:

- `reported`: `count`, the decisions triage left open, and `artifact`, triage's record: its report file (`reports.triage` in `factory ticket show <issue> --json`, in this worktree), whose `### Open decisions` lists them with triage's recommendations;
- `requested`: null when the lane brought the ticket here; otherwise the wait the owner asked `/grill` at (`from`, `gate`) and its `focus`;
- `models`: `stage`, the griller's model, and `back`, the ticket thread's, each a `modelSelection` as `t3_thread_configure` takes it;
- `commands.complete`: the command that exits the stage, with `grilled=<true|false>`.

You settle no decision yourself: the owner does, in this thread. You edit no files: align writes the spec, terms and decision records from your record.

**Acting on the tracker.** `factory ticket show <issue> --json` prints `artifacts`: `tracker` or `thread`. Under `thread` you post nothing on the issue. Under `tracker`, post as the project's identity: when `identity` in `<file>` names a `github_app` identity `<key>` in `factory.yaml`, prefix each `gh` command with `GH_TOKEN=$(factory github-app token --repo <repo> --identity <key>)`; otherwise run `gh` as it is.

## Steps

1. **Pick up where the grilling stands.** Read this thread back to the latest `grill:` line you posted. A wake that brings no answer from the owner (the sweep's nudge, a notice) while a round of yours waits on them: reply `grill: waiting on your answers to round <k>` and end your turn. The owner's message answering a round: go to step 4 with it. Otherwise this is a new grilling: go on.
2. **Switch the model.** Call `t3_thread_configure` with no threadId and `modelSelection` `models.stage`. Load the pinned `grilling` skill and work in its rounds, its format and its rule that a decision is the owner's and a fact is yours to look up.
3. **Gather the open decisions.** Read the issue with its comments (`gh issue view <issue> -R <repo> --comments`), triage's report file (`reports.triage`, in both modes) and its `### Open decisions`. When `requested` isn't null, read what its wait was about too: the escalation's reason, or the spec posted at `spec_approval` (its doc on the branch, `docs/specs/<issue>-<slug>.md`), and take `focus` as where to start. Read `GLOSSARY.md` and the decision records in `docs/decisions/` that touch the area.
4. **Ask in rounds**, in this thread: post `grill: round <k>`, then the round in the `writing-for-decisions` house style, as the pinned `grilling` skill hands it over; round 1 starts from triage's open decisions and recommendations. End your turn and wait for the owner's answers. Follow up where an answer opens a new question. Post nothing on the issue while the rounds run.
5. **Confirm.** When the frontier is empty, or the owner says `/done` (which ends the questions with what has been answered, the rest listed as still open), post `grill: confirm` with the shared understanding: each decision with its answer, the questions left open, and the glossary terms and decision records the spec should add. Ask the owner to confirm it, revise until they do, and write nothing before that.
6. **Write the record, then post it.** Run `factory ticket report-file <issue> --project-file <file> --json`: it names the report's `path` (`grill-v<k>.md` in `.factory/tmp/<issue>/`). Write the record there, headed `## Settled in grilling`, naming the approver who confirmed it (`@` and the login `gh api user --jq .login` prints without `GH_TOKEN`), where it came from (`requested`'s wait and focus, or "triage's open decisions"), each decision with its answer, the questions left open, and the terms and records for the spec. Under `tracker`, post the comment from that file: `gh issue comment <issue> -R <repo> --body-file <path>`, which prints the comment's URL; under `thread`, post nothing. Then append a `## For the owner` section as the file's last: one line with the decisions settled and left open. The thread publishes no grill page; its rounds are in this thread already.
7. **Complete the stage:** `factory ticket complete <issue> --evidence artifact=<the record's URL> --evidence grilled=true --evidence report=<path> --project-file <file> --json` (under `thread`, `artifact` is the report's path; the CLI records it). The ticket is now grilled: its spec needs no approval but under the `supervised` profile. When the owner declined the grilling, pass `grilled=false` instead (below).
8. **Switch back.** Call `t3_thread_configure` with no threadId and `modelSelection` `models.back`. Post `grill done: <the record's URL> · <decisions settled> settled, <left open> open`, then run `factory thread next <issue> --project-file <file> --json` and act on it as `factory-ticket-thread` says.

Done when the record is in its report file (and on the issue under `tracker`), `complete` has returned, and this thread is back on `models.back`.

## When the owner declines, or the CLI fails

**The owner declines the grilling** (at any round: "skip it", "just write the spec"): write and post the record as in step 6, headed the same, with `Declined by @<login>` in place of the confirmation, the decisions they did answer, and the rest listed as left open. Complete with `factory ticket complete <issue> --evidence artifact=<the record's URL> --evidence grilled=false --evidence report=<path> --project-file <file> --json`, then step 8. The ticket goes on ungrilled: align escalates what the spec needs and nobody settled, and the spec waits at `spec_approval` in the profile's mode (decision 0043).

**A command fails**: switch back (step 8's `t3_thread_configure`), reply with the command and the first line of its error, and stop.
