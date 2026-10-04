---
name: copilot-style-review
description: "Review a PR or branch the way GitHub Copilot code review does on this repo: a few verified defects, each with a concrete failure scenario and a fix. Use when asked for a Copilot-style review, to pre-check a PR before requesting Copilot, or to re-run Copilot's review locally."
---

# Copilot-style review

An emulation of GitHub Copilot code review. Copilot's own prompt isn't published, so this is distilled from the review comments it left on this repo's PRs (sampled 2026-10). Copilot also reads `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`; this repo has neither, so when one appears, apply it as extra rules in [The review](#the-review).

## Run it

1. **Scope.** `git fetch origin`, then take the diff: `gh pr diff <number>` for a PR, `git diff <base>...HEAD` for a branch (base defaults to `origin/main`). For a PR, the code you run checks against must be the PR's head: compare `gh pr view <number> --json headRefOid` with `git rev-parse HEAD`, and when they differ, check the head out in a temporary worktree. Gather the PR body (`gh pr view <number>`), the issue it closes, `AGENTS.md`, and every spec, ADR or contract under `docs/` that the diff touches or names. For a PR, collect earlier review findings so the review checks their fixes instead of raising them again: inline findings from `gh api repos/Ygilany/AskDB/pulls/<number>/comments` (top-level ones only, `in_reply_to_id` null; the replies say how each was handled) and review summaries from `.../pulls/<number>/reviews`. A reply's commit may have been rebased away; judge each fix by the current code. Done when you hold the diff, its stated intent, the prior findings, and a checkout at the head.
2. **Dispatch.** Hand the review to a fresh read-only subagent when your harness has one: give it this file's path, the scope from step 1, and the prior findings, and tell it to follow [The review](#the-review) and return its report. A fresh context reads the diff the way Copilot does, without the author's assumptions. With no subagent available, do [The review](#the-review) yourself.
3. **Relay.** Pass the report to the user. Posting to GitHub happens only when the user asks.

## The review

Work read-only: tracked files, the branch and the PR stay as you found them, and experiments go in a temp directory. Run only checks that leave shared state as found: type-checks, focused tests (the lab's included), `pnpm lab ask`, and a server you start, poke and stop. Reading the shared fixture and writing the lab's own gitignored caches (`.lab/artifacts`, scratch projects) are fine. The consumer lab's commands that reseed or stop the shared fixture (`lab:up`, `lab:reset`, `lab:down`, `fixture:*`) and `lab:use` (which rewrites the lab's manifests) are out of bounds; the [consumer-lab skill](../consumer-lab/SKILL.md)'s guardrails apply.

### Hunt

Every finding is a **defect** with a concrete failure scenario: a specific input or state, and the wrong result, crash, hang, leak or misled reader it produces. Any line in the diff is in scope, moved lines included; code outside the diff counts when the change makes it reachable or contradicts it. Copilot's findings here fall into these classes; apply every one to the diff:

- **Edge inputs silently accepted.** A blank, `null`, out-of-range, duplicate or oddly cased value that passes validation and falls through to different behavior instead of an error: `null` treated as absent, a blank field replaced by a default, two labels normalizing to one key, an ID format that isn't injective.
- **Lifecycle and failure paths.** Processes, sockets or timers that outlive shutdown or a timeout; races between two concurrent runs; a lock taken after the work it guards; state that changes under a long-running process; a failure path that exits before rollback; a cleanup command that can't work as printed.
- **Gate bypasses.** A safety check (SQL guardrail, tenant scope, CI gate, origin check) that a crafted input or an unusual-but-valid dialect form slips past. Try the dialect quirks: quoted identifiers, join hints, `OUTER APPLY`, nested set operations, comment syntax.
- **Claims that contradict the code.** README, docs-site, spec, ADR, JSDoc, changeset or PR description statements the code doesn't uphold; the same document or a sibling doc left stale by the change; a documented command that fails as written (wrong working directory, missing flag or file).
- **Repo policy.** `AGENTS.md` rules the diff breaks: a public API change without a docs-site update, a breaking change under a patch changeset, an engines floor below the documented one.
- **Tests that can't fail.** A new public or user-facing contract with no test; a test that passes for the wrong reason (`it.fails` swallowing setup errors, a test-only setter building state production can't reach, a fallback in a helper hiding the bug, a compiler option that skips the boundary under test).

Style, naming and taste are out of scope.

### Verify

Confirm each candidate before reporting it: trace the path end to end across files, and run a cheap check when it settles a doubt. A finding survives only when its scenario is reproduced, or traced through every hop with `path:line` evidence. Zero findings is a valid result; a speculative finding costs more than a missed one.

### Report

A one-line verdict, `No issues` when nothing survived verification and `Changes recommended` otherwise, then each finding, most severe first:

- **Title** (ten words or fewer), with severity: **high** for silent wrong results, data exposure or a bypassed gate; **medium** for a broken workflow or a misleading contract; **low** for misuse that fails loudly or rarely.
- **Location:** `path:line`, plus each cross-referenced `path:line`. A repeat elsewhere is "Also at `path:line`".
- **Problem:** two to four sentences: the scenario, the consequence, and why the code allows it.
- **Fix:** one or two sentences, naming the test that would catch it.
- **Verified by:** what you read or ran.

End with **Checked and sound**: one line per area you covered and found correct, so the reader sees the coverage. Copilot typically leaves one to six findings per round here.

An example in Copilot's register (PR #187): "JSON `null` is a non-string mode, but this condition treats it as absent and runs the request with the configured/default mode. That contradicts the new up-front validation contract that non-string body modes return `400 bad_request`; only an omitted field should fall through. This issue also appears on line 342 of the same file."
