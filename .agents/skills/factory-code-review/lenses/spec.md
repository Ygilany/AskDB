# Spec lens

Tier: standard

**Question:** does the final diff do what was asked, no more and no less? You trace requirements to code. You do not judge whether the code is good; other lenses do.

**Reads:** the spec (case file: *Spec*), the PR description if there is a PR, the commit list, the diff, and the profile's *Spec* and *What code review flags* sections.

**Skip** (report `n/a: no spec and no PR description`) when the case file has neither. When its *Spec* line says "issue source: from the user", emit a *Proposed profile addition* for the *Spec* section's issue tracker line. A PR description alone is a weak spec: check its claims, not its completeness.

## Checks

1. **Requirements to code.** List every requirement and acceptance criterion in the spec, one line each. For each, find the code and the test that carry it (`path:line`), or say none does. Quote the spec line in the finding.
2. **Scope creep.** Behaviour, flags, endpoints or exports in the diff that no requirement asks for. Refactors needed by a requirement are not creep; unrelated cleanups, extra options and speculative hooks are.
3. **Description vs final diff.** The PR description is a claim sheet. List every concrete claim (named tests, exported symbols, counts, behaviours such as "rejects X" or "falls back to Y", files touched, issues closed) and prove each against the diff at the head SHA, not earlier commits and not memory: `grep` for the symbol, the test runner's list mode, `gh pr view --json files`. Descriptions go stale after follow-up commits, merges and rebases: compare the commit list with the description and look hardest at what changed after it was last edited. Then apply the profile's *Spec* section, including its `### Description vs diff` list.
4. **Implemented wrongly.** A requirement that looks present but whose code does something else (inverted condition, wrong field, wrong default). Trace the path; do not infer from names.

## Severity

- A requirement missing or implemented wrongly: **blocking**.
- A requirement partially implemented: **should fix**; **blocking** when it is a stated acceptance criterion.
- A description claim the diff contradicts: **should fix**, because the cost is a misled reader, not a defect. **Blocking** only when the false claim is one a reviewer or user would rely on to accept the change: a guarantee, behaviour or test the diff does not deliver ("rejects X", "covered by test Y" where Y does not exist or cannot fail). A wrong sentence about where a test lives is should fix.
- Scope creep: **should fix**. It is a judgement call and the author may have had a reason.
- A spec ambiguous where the code picked one reading: **nit**, quoting the ambiguous line.

## Does not own

Whether the code is correct on edge inputs (Defects), whether a doc page is stale (Docs), whether the tests would catch a regression (Tests). A claim about docs or tests that is false is yours only when it sits in the PR description.

Tag: **Spec:**
