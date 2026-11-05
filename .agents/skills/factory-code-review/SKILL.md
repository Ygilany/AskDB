---
name: factory-code-review
description: The factory's copy of code-review, for its stages. Independent, multi-lens review of a commit range, branch or pull request. Six fresh agents (spec, standards, architecture, defects, tests, docs) each review the final diff in their own area, an aggregator merges their verified findings into one verdict, and the result is posted as a pending review with tagged line comments. Checks against the repo's review profile (`docs/agents/code-review.md`). Use when asked to review a PR, a diff, a branch or "everything since X", to pre-check a PR before marking it ready or requesting human or bot review, or to independently review agent-authored changes, and for review-and-fix loops ("until clean").
---

# Code review

An **independent** review: fresh readers check the final diff against what was asked, what the repo requires, and the failure modes authors routinely miss. Every finding is a **defect** with a concrete failure scenario, verified before it is reported. The output is one verdict, a report grouped by lens, and a pending review of tagged line comments.

A speculative finding costs more than a missed one, and zero findings is a valid result.

```
/factory-code-review <ref | #PR> [lens,lens,…]
```

The target is a ref, the fixed point to review since (a commit, branch, tag or `HEAD~5`; the diff is three-dot against the merge-base), or a PR number, which adds the description, prior findings and posting. An optional lens list runs only those lenses (`/code-review #12 architecture,tests`); the verdict names the lenses that ran, so a subset is never mistaken for a full review.

## Lenses

Six lenses, each with one area and one brief in [`lenses/`](lenses/). Every check has one owner; where two lenses report the same anchor, the aggregator keeps one finding.

| Lens | Asks | Tier |
|---|---|---|
| [`spec`](lenses/spec.md) | Does the diff do what was asked, and what the PR description claims? | standard |
| [`standards`](lenses/standards.md) | Does it follow the repo's documented rules and sound code-shape habits? | light |
| [`architecture`](lenses/architecture.md) | Is each behaviour built in the layer that owns it? | deep |
| [`defects`](lenses/defects.md) | What input or state makes it wrong or unsafe? | deep |
| [`tests`](lenses/tests.md) | Would the tests fail if the code were wrong? | standard |
| [`docs`](lenses/docs.md) | Does what is written match the code, and is everything that should be written, written? | light |

The tier is a hint, never a model name: `light` is the cheapest capable model your harness offers, `deep` the strongest, `standard` in between; inherit when the harness cannot choose. The profile can override a lens's tier.

## Independence

The reviewers are different agents from the one that wrote the change, and never the current thread. An author re-reads their intent; a fresh reader reads the code. This thread is the **lead**: a dispatcher and relay with no judgement of its own.

- The lead writes the [case file](references/case-file.md) from a fixed template (refs and paths only), starts the agents, posts, and relays.
- Each **lens agent** reads the case file and its brief, verifies its own findings, and writes its report to a file.
- A fresh **aggregator agent** reads the reports from files, dedupes, and derives the verdict.
- Each blocking finding gets a second, independent **verifier** agent.
- The lead may fix the format of the payload when posting fails. It may not edit, drop, rank or add findings, and it forwards lens reports and aggregator output unchanged.

Every agent prompt ends with: "Do not invoke `factory-code-review` or spawn further agents: perform this review directly." With no subagent available, stop: say the review needs fresh agents, and hand over the target and this skill's name. If this session wrote any part of the diff, say so in the review body (for example "dispatched from the authoring session; prompts limited to paths").

## Profile

Project-specific rules live in the target repo's `docs/agents/code-review.md`, one section per lens plus shared ones: when review is required, what code review flags, verification commands, guardrails, posting, stacked PRs. It overrides this skill's defaults wherever the two differ. The lens briefs name the sections they read; every lens reads *What code review flags*, the classes of finding the repo's reviewers keep raising, and weights its hunting toward its own.

If the profile is missing, review on the defaults, run only type-checks and the unit tests the diff touches, and have the aggregator end the report with a **draft profile** built from what the lenses inferred; tell the user to run `/setup-ygilany-skills` to turn it into the real one. Review never writes the profile: a lens that relied on an inferred rule emits a *Proposed profile addition* (section name and paste-ready text), and the report collects them.

## Working rules

No agent runs the project's full test suite: CI runs it on the PR, and its required check is the authority a merge waits on. Agents run type-checks and single tests by name or file, each command in the foreground, and start no background command, so an agent's turn ends with its result.

An agent's reply that holds no path (a lens, the aggregator, a verifier) is **interim**, even when its task reports done: don't use it and don't end your turn. Wait on the same agent again, and if it is idle with no path, send it one follow-up asking for the path in the required form, then wait again; start it afresh only when it fails or still gives none. Never end your turn while an agent you started owes a reply.

Everything is read-only: tracked files, the branch and the PR stay as you found them, and experiments go in a temp directory or scratch worktree. Run only what the profile's *Guardrails* allow; shared databases, containers and services stay as you found them.

## Severity

- **Blocking**: a defect reachable by some input today, a gate on a trust boundary that a crafted input bypasses, a test that does not prove the fix, a requirement missing or wrong, a false claim of a guarantee the diff does not deliver, a broken documented layer rule.
- **Should fix**: a real defect or gap with lower impact: misuse that fails loudly or rarely, a misleading contract, a stale doc, scope creep. A defect with no reachable input today is should fix, unless the profile's *Sensitive areas* say otherwise for that path.
- **Nit**: style or clarity with no behavioural effect, and code smells. Nits never drive the verdict and need no failure scenario.

Each lens brief refines these for its area.

## Loop

For review, fix, review again, read [`references/loop.md`](references/loop.md) before round 1: it holds the exit, the round cap and when to stop and ask.

## Process

1. **Parse the target.** Split the arguments into the target and an optional lens list; an unknown lens name stops with the valid names. For a PR, resolve it: `gh pr view <n> --json number,title,body,baseRefName,headRefOid,commits,files,closingIssuesReferences`. For a ref, confirm it resolves (`git rev-parse`) and the diff is non-empty. Stop on either failure, before anything is dispatched. If the checkout has uncommitted changes and the target is not a PR, stop: "commit first; review covers committed work only".

2. **Build the case file.** Create the work directory and a scratch worktree at the head SHA (`git fetch origin pull/<n>/head && git worktree add <dir> <sha>` for a PR). Save the PR description, the commit list and, for a PR, the prior findings to files ([`references/github.md`](references/github.md), *Prior findings*). Find the spec in this order: issue references in commit messages and the closing issues (fetched as `docs/agents/issue-tracker.md` or the profile's *Spec* section describes; when neither does, ask where issues live and mark the case file's *Spec* line "issue source: from the user", so the Spec lens emits it as a *Proposed profile addition*), a path the user passed, a spec file under `docs/`, `specs/` or `.scratch/` matching the branch name, else ask; "none" is a valid answer and the Spec lens skips. For a stacked PR, diff against the base the profile's *Stacked PRs* section names. Fill in [`references/case-file.md`](references/case-file.md).

3. **Dispatch the lenses.** In one turn, start one agent per lens, in parallel, each at its tier, with the lens agent prompt. Wait for the report paths.

4. **Merge.** Start the aggregator with the merge-phase prompt. It returns the path of `merged.md` and the ids of the blocking findings.

5. **Verify.** In one turn, start one verifier per blocking finding, at the `deep` tier, with the verifier prompt. A verifier sees the finding and the case file, never the other lenses' reports.

6. **Finalize.** Start the aggregator again with the finalize-phase prompt. It writes `review.md` and `review.json`: confirmed findings stay at their severity (or the lower one a verifier gave, with its reason), refuted ones are dropped and listed as "dismissed after verification", and a finding the verifier could not settle stays blocking with "second reviewer could not reproduce".

7. **Post.** For a PR, create a pending review from `review.json` per the profile's *Posting* section and [`references/github.md`](references/github.md). The review posts from the user's own forge account, so the verdict belongs to a human: it stays pending unless the profile or the user asks for `COMMENT`, and it never approves. The lead prepends a disclosure block to the body, built from the case file's *Models* record: one line saying who ran it and that it is neither a human review nor an approval, and one line listing each lens with the model that ran it, then the aggregator and the verifiers (see [`references/github.md`](references/github.md) for the shape). If a pending review by that account already exists, stop and report it; it may hold the user's own drafts. When the user wants chat only, or the target is not a PR, skip posting.

8. **Relay.** Show `review.md` unchanged, with a link to the pending review. If the profile was missing, remind the user of the draft profile at its end. Remove the scratch worktree, and any the lens agents made for themselves (the Tests lens creates one): `git worktree list` shows them, and each lens report's *Not reviewed* may name its path. Remove the work directory too once `review.md` is relayed.
