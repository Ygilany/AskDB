# Case file and agent prompts

The lead writes the case file and every prompt from the templates below, filling in values and nothing else. A prompt carries paths and refs only: no hypotheses about what is right or wrong, no description of what the change does, no hints about where to look.

## Case file

Write it to `<work dir>/case.md`, where `<work dir>` is a fresh temp directory (`mktemp -d`); reports go in `<work dir>/reports/`.

```markdown
# Case file

- Target: <ref, or PR number>
- Diff command: git diff <merge-base>...<head sha>
- Head SHA: <sha>
- Base: <base ref and merge-base sha>
- PR: <number and link, or none>
- PR description: <path to a file holding it verbatim, or none>
- Commit list: <path, from git log --format='%h %s%n%b' <merge-base>..<head sha>: full messages, because a commit body is a claim sheet when there is no PR>
- Spec: <issue or file reference, or none>; add "issue source: from the user" when neither the profile nor `docs/agents/issue-tracker.md` said where issues live
- Prior findings: <path to a file holding them verbatim, or none>
- Profile: <path to docs/agents/code-review.md, or none>
- Scratch worktree: <path>, a detached checkout of the head SHA. Read-only for everyone.
- Report dir: <path>
- Scratch rule: experiments run in a fresh `mktemp -d` directory. Packages are read through a read-only path (for example `NODE_PATH` pointing at the checkout's installed `node_modules`); nothing is installed, and nothing is written under any `node_modules`, the scratch worktree or the author's checkout.
- Lenses this run: <names>
- Lens briefs: <path to each lens file>
- Tiers: <lens: tier, with profile overrides applied>
- Models: <filled in by the lead as it starts each agent: lens, aggregator and verifier, each with the model name and id it ran on; "inherited (<this thread's model>)" when the harness could not choose>
```

## Lens agent prompt

> Review the change described in `<case file path>` through the `<lens>` lens only. Read your brief at `<lens brief path>` and `references/report.md` in the same skill, then follow them, including the case file's Scratch rule. Write your report to `<report dir>/<lens>.md` and return only that path. Run every command in the foreground, start no background command, and never run the project's test suite (CI runs it): run single tests by name or file. End your turn only by returning the path. Do not invoke `factory-code-review` or spawn further agents: perform this review directly.

Run each lens at its tier: `light` is the cheapest capable model the harness offers, `deep` the strongest, `standard` in between; when the harness cannot choose, inherit. Start all lens agents in the same turn so they run in parallel.

## Aggregator prompt, merge phase

> Read `<case file path>` and every report in `<report dir>`. Following the aggregator section of `references/report.md`, dedupe findings across lenses and write `<report dir>/merged.md`: all surviving findings with ids (`F1`, `F2`, …), each with its lens, tag, severity, anchor, and any "also flagged by". End with the ids of every finding with severity blocking. Return only the path. Run every command in the foreground, start no background command, and never run the project's test suite (CI runs it): run single tests by name or file. End your turn only by returning the path. Do not invoke `factory-code-review` or spawn further agents: perform this task directly.

## Verifier prompt

One per blocking finding, started in the same turn, at `deep` tier:

> A reviewer reports the finding below. Decide independently whether it is real, in the checkout at `<scratch worktree>` (head SHA `<sha>`). Reproduce the scenario or trace it through every hop with `path:line` evidence; do not trust the reviewer's evidence. Work read-only and follow the case file's Scratch rule. Write `<report dir>/verify-<id>.md` as specified in `references/report.md`, including whether the finding's severity is justified and return only that path. Run every command in the foreground, start no background command, and never run the project's test suite (CI runs it): run single tests by name or file. End your turn only by returning the path. Do not invoke `factory-code-review` or spawn further agents: perform this check directly.
>
> <the finding's scenario and anchor, copied verbatim; leave out the reporter's evidence and fix, so the verifier forms its own view>

## Aggregator prompt, finalize phase

> Read `<report dir>/merged.md` and every `verify-*.md` in `<report dir>`. Apply the verdicts: confirmed stays blocking; refuted is dropped and listed under "dismissed after verification" with one line of why; cannot tell stays blocking and is marked "second reviewer could not reproduce". Then write `<report dir>/review.md` and `<report dir>/review.json` as specified in `references/report.md`, applying any severity a verifier lowered. Return only the two paths. Run every command in the foreground, start no background command, and never run the project's test suite (CI runs it): run single tests by name or file. End your turn only by returning the paths. Do not invoke `factory-code-review` or spawn further agents: perform this task directly.

Run the aggregator at `light` tier. When the harness cannot resume an agent, each phase is a new agent: both phases read their input from files, so none of them needs memory of the other.
