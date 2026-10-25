---
name: factory-test-campaign
description: "Run the weekly test campaign over one project's test suite: audit it with the factory-test-audit skill's campaign mode in a fresh worktree, read-only, and file and start one quick factory issue per subsystem with the findings."
---

# Factory test campaign

You run the weekly test campaign for one project, in a thread of its own (decision 0046). You audit the project's whole test suite with the `factory-test-audit` skill in **campaign mode**, and you hand what it finds to the factory as tickets: one `factory` issue per **subsystem**, each small enough for the quick lane, with the findings in its body. The factory's tickets make the changes; this run is read-only, so the project's branches, PRs and files stay as you found them.

Run every `factory` command with `--json`.

## 1. Set up

1. **Project**: the slug your task names. Its entry in the factory's `projects/registry.yaml` gives the repo and the checkout's `path`; its manifest (the file `factory config check --json` prints as `project` when run in the checkout: `.factory/project.yaml`, or the registry entry's `manifest:`) gives `base_branch`, `tracker` and `test_tiers`.
2. **Worktree**: a fresh detached checkout of the base branch as it is on origin: `git -C <path> fetch origin <base_branch>`, then `git -C <path> worktree add --detach <dir> origin/<base_branch>` with `<dir>` from `mktemp -d`. Every later step reads this worktree, and step 4 removes it.
3. **Open tickets**: the project's open issues labelled `factory` (`gh issue list -R <repo> --label factory --state open --json number,title,body`). A subsystem already covered by an open campaign issue (title `Test campaign: <subsystem>`) is skipped this week.
4. Read `skills/factory-test-audit/SKILL.md` and `skills/factory-test-audit/CAMPAIGN.md` in the factory's checkout (the folder beside the `factory.yaml` that `factory --help` prints as the `--config` default; never search the disk for them), and the project's `AGENTS.md` (or `CLAUDE.md`) and test guidance.

Done when the worktree exists at origin's base head and you have the list of open campaign issues.

## 2. Audit the suite

Run `CAMPAIGN.md`'s steps 1 to 4, over the whole suite rather than one subsystem:

- **Baseline**: every test file's pass or fail state at the worktree's head, with the commands under `test_tiers`. A baseline failure is a finding of its own (a possible product bug), not a test to mark.
- **Lanes**: split the suite into **subsystems** along production owner boundaries, as its step 2 describes; each subsystem becomes at most one issue.
- **Ledger**: one read-only agent per subsystem marks every test declaration `R`, `F`, `C` or `D` with its evidence line, as its step 3 describes.
- **Layer plan**: per subsystem, the keeper per contract, the tests to retire, the assertions to carry into keepers and the test-only production seams unlocked, as its step 4 describes.

The campaign stops at the plan: its cutover, preservation review and product-defect steps are the tickets' work.

Done when every test file belongs to one subsystem, every declaration in each has a mark and an evidence line, and each subsystem with an `F`, `C` or `D` mark, or a baseline failure, has its layer plan.

## 3. File and start the tickets

For each subsystem with an `F`, `C` or `D` mark or a baseline failure, and no open campaign issue, file one issue as the signed-in approver, so the factory takes it in:

```
gh issue create -R <repo> --label factory --title "Test campaign: <subsystem>" --body-file <file>
```

The body:

- what the campaign covered (the head SHA, the subsystem's test files and their baseline);
- the acceptance criteria: each `F` repaired, each `C` consolidated into its named keeper, each `D` deleted with the proof that remains named, each unlocked seam removed, and the subsystem's tests green;
- the ledger rows behind them, with their evidence lines, and the layer plan;
- each baseline failure, as a possible product bug to reproduce before any test is touched;
- the scope: test-only changes plus the seams they unlock, sized for the quick lane (`lanes.quick.budget` in the factory's `factory.yaml`); a plan bigger than that says so, and triage sizes it.

A subsystem with nothing to change gets no issue.

Then start each issue you filed, right after `gh issue create` returns its number, with `gh` still signed in as the approver (no `GH_TOKEN`), so the start is credited to the owner:

```
factory ticket start <n> --project-file <path>/.factory/project.yaml --json
```

The router starts an owner's `factory` issue on its `issues.opened` delivery, but it may be off or miss it, and an issue nobody starts blocks its subsystem from the next campaign. Read the outcome:

- exit 0: started;
- exit 1 with the first line `ticket already started (stage <stage>)`: the router got there first, so it counts as started;
- any other failure: the issue stays filed, the reply names it with the first line of the error, and you go on to the next issue. Do not retry, close or edit it.

Start every issue you filed this run, however many. The project's `wip` cap queues the builds. Launching a started ticket's thread is not yours: the sweep does it.

Done when every subsystem with findings has an issue, open from before or filed now, and each issue filed now is started or named as not started.

## 4. Clean up and reply

Remove the worktree (`git -C <path> worktree remove <dir>`) and the ledger agents' scratch directories.

Reply in one line: `<project> test campaign at <short sha>: <subsystems> subsystems, <filed> issues filed (<#n, …>), <started> started (<#n, …>), <skipped> skipped as already open, <failures> baseline failures`, followed, only when a start failed, by `; not started: #<n> <first line of its error>, …`.

Done when the worktree is removed and you have replied.
