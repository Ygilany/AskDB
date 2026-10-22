---
name: factory-review
description: "Run one round of a ticket's review stage: review its PR with the lane's lenses and a second model, merge the findings into one verdict, post it on the PR, then complete the stage or fail it back to build."
---

# Factory review

You are the reviewer for one factory ticket, running in the ticket's worktree on its PR branch. Each run of the stage is one **round**: the lane's `code-review` lenses, each a fresh agent at its tier, plus a **second opinion** from another model. You merge what they find into one **verdict**, record it, post it on the PR and exit the stage. You are read-only: the worktree, the branch and the PR stay as you found them, and build fixes what you find (decision 0045). Zero blocking findings completes the stage; any blocking finding fails it, and the factory sends the ticket to build with your findings in its brief, or escalates after the last round.

The `factory` CLI decides lanes, routing and limits. Call it with `--json`.

## 1. Gather the round's inputs

- **Ticket**: the issue number from your brief. `factory ticket show <n> --json` must report `stage: review` and `status: active`; if it doesn't, report what it shows and stop.
- **Round and limit**: your brief's line "This run is round `<r>` of the review_fix loop's `<limit>` rounds". `r` is what you record and report; the CLI refuses any other.
- **Lenses**: your brief's line "The `<lane>` lane's review lenses: …" (`lanes.<lane>.review_lenses` in `factory.yaml`). Each is a lens of the pinned `code-review` skill, with its brief in that skill's `lenses/` folder and its tier in its Lenses table.
- **PR**: the open PR for this branch, `gh pr view --json number,url,baseRefName,headRefOid,body`. With none, `factory ticket fail <n> --reason "no open PR for review" --json` (build opens it) and go to step 5's reply.
- **Base**: `origin/<baseRefName>` after `git fetch origin <baseRefName>`, and its merge-base with the head.
- **Last reviewed head**: your brief's line "Range from: …". The CLI computes it: the head the loop's last round reviewed, or `none` when no round has reviewed one since the loop last started (the ticket started, was moved, changed lane, or passed review). This round is a **range** round when it names a head and that head differs from the PR's head: build pushed a fix since. Otherwise it is a **full** round, over the whole PR.
- **Earlier findings**: the `findings` of the ticket's latest `review_round` event (`factory ledger list --ticket <n> --json`) when the brief names a head, and the reason the brief quotes when it says the stage is running again after a send-back to build.
- **Author**: the model that wrote the PR, named in your brief; otherwise `chosen.model` from `factory route implementer --lane <lane> --json`.
- **Second opinion model**: `factory route second_opinion --lane <lane> --author <author> --json`. Use `chosen`, unless its model is the one you are running on; then take the first entry in `fallbacks` that isn't. Routing puts the author's model last and chooses it only when no other is usable (decision 0047).
- **Profile**: the project's `docs/agents/code-review.md`, which each lens reads.

Done when every input above has a value, and you know whether the round is full or range.

## 2. Review

Build the round's case file from `code-review`'s `references/case-file.md`, in a fresh `mktemp -d` work directory with a scratch worktree at the head SHA. Its diff command is `git diff <merge-base>...<head sha>` for a full round, and `git diff <last reviewed head>..<head sha>` for a range round; its prior findings file holds the earlier findings.

Start these in one turn, so they run in parallel:

- **One fresh agent per lens** of the lane, at the lens's tier (profile overrides applied), with `code-review`'s lens agent prompt from `references/case-file.md`. A range round runs the same lenses as round 1.
- **The second opinion**, through T3's `delegate_task` with the second opinion model's `provider` as `providerInstanceId` and its `model`, mode `async`, `clientRequestId` `review-<n>-round-<r>`. It always reads the **full** diff, `git diff <merge-base>...<head sha>`, which is what keeps a range round from missing a regression in code the fix left alone. Its task:
  - the repo path, the PR number and that diff;
  - the lenses, with the absolute path of each brief in `code-review`'s `lenses/` folder;
  - the bar: report only **blocking** findings as `code-review` defines them, each with `file:line`, a concrete failure scenario and the evidence that reproduces it; zero findings is a valid answer;
  - the earlier findings, so it checks each one is fixed;
  - read-only: change no files, branch or PR, and start no further agents;
  - the reply: one line per finding, `BLOCKING <file>:<line> — <defect> — <failure scenario>`, or `NO BLOCKING FINDINGS`.

  Wait for it with `task_status`. If the task fails or its model is unavailable, retry once on the next qualifying fallback.

These are all the agents the round starts: you are the lead and the merger.

Done when every lens agent has returned its report path and the second opinion has replied.

## 3. Merge the verdict

Read every lens report and the second opinion's reply. The round's **blocking findings** are each lens's blocking findings, plus each second-opinion finding whose anchor no lens report covers; where two report the same anchor, keep one and note who else flagged it. Weigh a finding by its evidence: one you can't trace to `file:line` in the scratch worktree is non-blocking, with one line of why. Should-fix findings and nits go in the verdict as non-blocking; the owner may file them as follow-ups.

Record the round:

```
factory ledger record <n> --type review_round --json --data '{"round":<r>,"maxRounds":<limit>,"pr":<pr number>,"headSha":"<head sha>","lenses":[{"lens":"<lens>","model":"<model id>","blocking":<count>,"nonBlocking":<count>},…],"blocking":<count>,"security":0,"findings":[{"lens":"<lens>","file":"<path>","line":<line>,"summary":"<one line>"},…]}'
```

- `lenses`: one entry per lens that ran, and one for the second opinion (lens `second_opinion`, its model, its blocking count after dropping duplicates, `nonBlocking` 0).
- `findings`: one entry per blocking finding; the second opinion's carry lens `second_opinion`. The retro reads them.
- `security` stays 0: no security pass runs in the review stage.

The CLI rejects an event whose fields are missing, misnamed or of the wrong type; fix the data and record it again.

**If the output has `stalled`,** the factory found the loop isn't converging and has already escalated the ticket. Run no `factory ticket` command; post the verdict (step 4) naming the condition, and reply (step 5) with `escalated`.

**If `ledger record` fails after the round was recorded,** the stall may have applied only in part. Run `factory ticket show <n> --json`. If the ticket is still `active` at `review`, nothing moved: go on to step 4. Otherwise run no transition, put the error line in the verdict, and end as for `stalled`.

Done when the round is recorded with its blocking count and findings.

## 4. Post the verdict

Post one comment on the PR (under `artifacts: thread`, which `factory ticket show <n> --json` prints, with no AI disclaimer and no `<!-- factory:… -->` marker): the round (`<r>` of `<limit>`, full or range, the head SHA reviewed), the models that ran (each lens and the second opinion), each blocking finding with its `file:line`, failure scenario and lens, each earlier finding as fixed or still open, the non-blocking findings, and the outcome. Post it as the project's identity, resolved as `factory-open-pr` §1 says (the manifest's `identity`, else `default_identities.<tracker host>`), and fail closed: for a `github_app` identity `<key>`, `t=$(factory github-app token --repo <repo> --identity <key>) && [ -n "$t" ] && GH_TOKEN=$t gh pr comment <pr> --body-file <file>` (`GH_ENTERPRISE_TOKEN` off `github.com`). If the mint fails, post nothing, keep its error line for your reply, and still exit the stage.

Done when the comment is posted, or the mint's error line is kept.

## 5. Exit the stage and reply

Unless the round stalled:

- **Zero blocking findings**: `factory ticket complete <n> --evidence blocking=0 --evidence pr=<pr url> --evidence head_sha=<head sha reviewed> --evidence rounds=<r> --json`. The merge stage merges that head only.
- **Blocking findings**: `factory ticket fail <n> --reason "<count> blocking: <file>:<line> <one line>; …" --json`, one entry per blocking finding. The CLI sends the ticket to build with this reason in its brief, or escalates when `r` was the last round.
- **A decision only a person can make** (the spec and the code disagree on what was asked, say): `factory ticket escalate <n> --reason "<the question>" --json`. The CLI records the round itself.

Reply with the verdict for the ticket thread, at most ten lines: first `<repo>#<n> review round <r>/<limit>: <completed|sent back|escalated>, <b> blocking (<pr url>)`, then one line per blocking finding (`<file>:<line> <one line>`), then the count of non-blocking findings, and any error line kept from step 4.

Done when the CLI has accepted the completion, the failure or the escalation, and you have replied. If it rejects one, reply with its error line and stop.
