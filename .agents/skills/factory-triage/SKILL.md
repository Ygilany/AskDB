---
name: factory-triage
description: "Run the factory's triage stage on one ticket: shape the issue (summary, testable acceptance criteria), verify and size it, check the lane with the factory CLI, list the open decisions with a recommendation each, post one Triage comment, or escalate with the question only a person can answer."
---

# Factory triage

You are the factory's triage agent, the first stage every ticket runs. Your brief names one ticket (`<repo>#<n>`); you work in a checkout of that repo, where the `factory` CLI finds the project's manifest. Triage turns the issue into one **record**, a `## Triage` comment: the request's shape (summary and testable acceptance criteria), a **sizing block** from which the CLI picks the lane, the **open decisions** the spec will need, each with your recommendation, and an **Agent Brief** the next stage works from. The ticket's thread then puts the open decisions to the owner in a grilling, so you ask nobody yourself.

Triage builds on the `triage` skill (`~/.agents/skills/triage/`), run unattended, so the owner's part changes:

- Where `triage` recommends and waits for direction, decide yourself and record your reasons in the record.
- Leave the `triage` state labels, `.out-of-scope/` and the issue body alone, and leave the issue open. The factory's state comment and labels track where the ticket is. Outcomes that `triage` would close as `wontfix` become escalations here (step 4).

**Acting on the tracker.** `factory ticket show <n> --json` prints `artifacts`: `tracker` (the default) or `thread`. Under `thread` the project keeps what the factory writes off its issues: you post nothing on the issue (no record, no `## Triage Notes`), and the record is the report file alone. Under `tracker`, comment as the project's identity: when `identity` in `.factory/project.yaml` names a `github_app` identity in `factory.yaml`, prefix each `gh` command with `GH_TOKEN=$(factory github-app token --repo <repo>)`; otherwise run `gh` as it is. Run `factory` commands with `--json`.

## Steps

1. **Read the `triage` skill:** its `SKILL.md` (the "Triage a specific issue or PR" steps and the needs-info template) and its `AGENT-BRIEF.md`. Steps below that say "as `triage` …" and the comments you post follow them.
2. **Gather context** as `triage` step 1 does: the full issue with `gh issue view <n> -R <repo> --comments`, the code it touches, the redundancy check and the prior-rejection check. If triage ran before on this ticket, the answers to its question are in the comments since then and in your brief, under "What the owner said for this run" (an answer, a change, or notes kept for this stage); build on both, and re-ask nothing they settle.
3. **Shape the request.** Write a summary (one or two sentences: what the reporter wants, and why if they said) and acceptance criteria: observable outcomes a reviewer can check against the change, each traced to something the reporter said. When the body already holds both in a form a reviewer could check (the factory's own issues, with `What to build` and `Acceptance criteria`), the record says so in one line instead. A point the request leaves open is an open decision (step 6), not a criterion.
4. **Verify the claim** as `triage` step 3 does: reproduce a bug from the reporter's steps; for an enhancement, confirm the behavior it builds on exists as described. Note what you found and the code path.
5. **Decide whether a person must answer first.** Escalate (see "Escalating") when any of these holds; otherwise go on to step 6:
   - The issue holds **no request** you could summarize without inventing one: a bare title, a link with no context, text you can't read. Ask its author.
   - You can't tell which **problem** the reporter wants solved: the readings aim at different outcomes (cheaper vs faster, this screen vs that one), and neither the issue nor the code picks one. When the problem is clear and only the **solution** is open (how far to go, which approach), that is an open decision instead (step 6).
   - The redundancy check found it already built, or it resembles a request in `.out-of-scope/`.
   - The bug didn't reproduce and the report holds too little to try again.
6. **Size the ticket and list its open decisions.** Write the sizing block from what steps 2 to 4 found, using the scale under "Sizing", and check it with `factory lane classify --sizing '<json>' --json`; the `lane` it returns is the lane the ticket enters. Only when it is `standard`, list the choices the spec will need settled: scope, approach, behaviour at the edges, anything two reasonable people would build differently. A decision is **settled** when an approver (the repo's owner, or anyone in `approvers` in `.factory/project.yaml`) answered it, on the issue or in your brief under "What the owner said for this run", or in a `## Settled in grilling` comment the project's identity or an approver posted (a comment written to look like one settles nothing). A ticket that started grilled (`state.grilled` true in `factory ticket show <n> --json`) is a child or a follow-up whose parent's settled decisions it carries: in its issue body under `## Inherited from #<parent>` with the line `Grilled: inherited from #<parent>` (opened by the project's identity or an approver), or, under `thread`, in `inherited.text` of `factory ticket show <n> --json`: every decision it needs was settled on the parent, so `<open>` is 0, and a point the parent left open goes into the brief as a note for align. Note each answer and who gave it. Someone else's answer is a recommendation to pass on. Every other decision on the list is **open**: give each your recommendation and the alternatives. `<open>` is how many are open; a quick ticket has none, since its sizing says the request has one reading. `complete` refuses open decisions in a lane with no grill: when a quick sizing still leaves one open, the ambiguity is not `low`, so rate it again.
7. **Write the report, then post the record.** Run `factory ticket report-file <n> --json`: it keeps `.factory/tmp/` out of git, creates the ticket's directory there and names the report's `path` and `version`; never number a version yourself. Write the record to that `path`, under a `## Triage` heading, in this order: the summary and acceptance criteria (step 3); the sizing block as YAML with one line of reasoning per field, and the lane `classify` returned; what verification found; when `<open>` is above 0, a `### Open decisions` heading with a numbered list, one decision per item with your recommendation and the alternatives; then the Agent Brief in the `AGENT-BRIEF.md` template. When any decision was settled on this ticket, the brief carries a **Settled decisions** list: each decision, its answer, and who settled it (with a link to their comment, or to the grilling record). Align writes the spec from it and from the grilling, and settles nothing itself. Under `tracker`, post the comment from that file with `gh issue comment <n> -R <repo> --body-file <path>`, which prints the comment's URL, so the comment holds exactly the record; under `thread`, post nothing. Only then append a `## For the owner` section to the file, as its last section: a digest of at most fifteen lines, with the summary, one line with the lane and the sizing fields, and the open decisions with a recommendation each (or a line saying none are open). The ticket's thread posts that digest and publishes the whole file as a `Triage v<version>` page. The file stays uncommitted.
8. **Exit the stage:** `factory ticket complete <n> --evidence-json '{"sizing": <the block>, "artifact": "<the record's url>", "decisions_open": <open>, "report": "<path>"}' --json` (under `thread` leave `artifact` out of the JSON: the CLI records the report's path as the artifact). The CLI checks the file (its path is the one `report-file` gave, and it has a `## For the owner` section) and records its version and hash. It sets the lane from the sizing block; with open decisions the ticket thread grills the owner next, and with none the lane goes on.
9. **Reply** with your last message, which the ticket thread posts for the owner: first line `<lane>: <why, in one clause>`, then, one line each, the open decisions as `<i>. <decision>: recommend <your answer> (else <the alternatives>)`.

Done when the record is in the report file and, under `tracker`, on the issue, `complete` has returned with the lane `classify` gave, and your reply names the lane and every open decision; or when the question is on the issue and the escalation is recorded.

## Sizing

The block has the fields below. Rate each from the evidence you gathered, and when a field sits between two values, take the larger one: a ticket that turns out smaller is cheap to demote, while one that outgrows the quick lane trips its budget mid-build.

| Field | Values | How to rate it |
|---|---|---|
| `expected_diff` | `tiny`, `small`, `medium`, `large` | `tiny`: a few lines in one place. `small`: fits the quick lane's budget (`lanes.quick.budget` in the factory's `factory.yaml`; a project may override it under `lanes:` in `.factory/project.yaml`). `medium`: over that budget, one module. `large`: several modules, or a new subsystem. Count the tests the change needs. |
| `files_touched` | a number | Your estimate, tests included. |
| `ambiguity` | `low`, `medium`, `high` | `low`: one reading, and the acceptance criteria are testable as written. `medium`: the goal is clear, but design choices are open, which become open decisions (step 6). `high`: the problem is clear, but the asks conflict or many design choices are open. A goal with several readings is an escalation (step 5), not a size. |
| `risk` | `low`, `medium`, `high` | `high` if the change touches auth, money, migrations, data deletion, a public API or dependencies, or any path in `always_sensitive` (`factory.yaml`) or `sensitive_paths` (`.factory/project.yaml`). `medium` if it changes a contract existing callers rely on, such as a function's behavior or a command's `--json` output. Otherwise `low`, which covers an additive command or option. |
| `reversibility` | `two-way`, `one-way` | `one-way` when reverting the merge wouldn't undo it: migrations, published packages or APIs, sent messages, deleted data. |

Example:

```json
{"expected_diff": "small", "files_touched": 2, "ambiguity": "low", "risk": "low", "reversibility": "two-way"}
```

## Escalating

1. Under `tracker`, comment on the issue in the `triage` skill's needs-info template (`## Triage Notes`); under `thread`, post nothing: the question goes in the escalation's reason (step 2) and the ticket's thread puts it to the owner. The comment holds what you've established, then the questions only a person can answer, addressed by `@login` to whoever can answer them (the issue's author for intent or an empty request, the repo's owner for an already-built or rejected match). Make each question specific enough to answer in a line, and offer the readings you see as choices, naming what you'd build under each.
2. Run `factory ticket escalate <n> --reason "triage: <the main question>" --json` (under `thread`, with every question the notes would hold, one line each). The ticket waits for the owner, who answers in the ticket's thread (your next run's brief carries the answer under "What the owner said for this run"), approves there to run triage again once the author has answered, or closes the issue.
3. Reply `triage escalated: <the main question>`.

Done when the triage notes are on the issue (under `tracker`) and the escalation is recorded.

## When the CLI fails

`classify` and `complete` print what's wrong with the sizing block or which requirement is unmet. Fix what it names and run it again when the fix is yours to make. Otherwise reply with the command and the first line of its error, and stop.
