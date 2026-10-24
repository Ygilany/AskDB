# Report formats

Three shapes: a lens report, the aggregator's output, and a verifier verdict. Lens agents and the aggregator write files into the case file's report directory and return only the path.

## Lens report

`<report dir>/<lens>.md`:

```markdown
# <Lens> lens report

Head SHA: <sha>
Status: ran | n/a: <reason>

## Findings

### F1: <short title>
- Tag: <the lens's tag>
- Severity: blocking | should fix | nit
- Anchor: <path>:<line> (or <path>:<start>-<end>) | review body
- Scenario: <the input or state, what goes wrong, why the code allows it>
- Fix: <what to change, and the test that would catch it>
- Evidence: <command run, grep, or path:line trace>
- Pre-existing: <path:line>, when the finding concerns old code the change newly relies on
- Proposed profile addition: <profile section name, then paste-ready text>, when you used an inferred rule

## Checked and sound
- <one line per check you ran and found correct, with the evidence>

## Not reviewed
- <files skipped, checks n/a and why, commands not run>
```

Rules for a lens:

- **Refer to findings by title**, never by id, in *Checked and sound* and *Not reviewed*: the aggregator renumbers findings, so a lens-local `F1` would point at the wrong finding.
- ***Not reviewed* lists your own gaps** (files, checks or commands you did not cover and why), never another lens's area. Note an observation for another lens only as a finding of yours if it is in your scope; otherwise leave it out.
- **A lens with nothing to check** writes `Status: n/a: <reason>` and nothing else. Never an empty report.
- **Verify before you write.** A finding survives only when its scenario is reproduced, or traced through every hop with `path:line` evidence; drop any you cannot demonstrate. A speculative finding costs more than a missed one, and zero findings is a valid result.
- **Anchor** is a line inside a diff hunk at the head SHA, confirmed with `git diff <base>...<sha> -- <path>`. When no changed line fits (a missing file, a stale description, code outside the diff), anchor on `review body` with a `path:line` or "n/a". A finding about pre-existing code the change newly relies on anchors on the changed line that relies on it.
- **Prior findings.** Drop a finding that an earlier review comment (case file: *Prior findings*) already raises at the same place, unless that comment's fix is incomplete; then keep it and link the comment.
- **Suggestion blocks.** When the whole fix fits inside the anchored lines and a wrong suggestion would be obvious on read, put a GitHub suggestion block under *Fix*. Everything else stays prose.
- **Register.** Write the way a good reviewer would: the scenario, the consequence, why the code allows it, and the fix, in a few plain sentences. For example:

  > JSON `null` is a non-string mode, but this condition treats it as absent and runs the request with the configured default. That contradicts the new up-front validation contract that non-string body modes return `400 bad_request`; only an omitted field should fall through. This issue also appears on line 342 of the same file.

## Verifier verdict

`<report dir>/verify-<finding id>.md`: `Verdict: confirmed | refuted | cannot tell`, then `Severity: keep | lower to <should fix | nit>: <one line why>`, then the evidence in a few lines. A verifier confirms the facts and judges whether the consequence justifies blocking: a true finding with a trivial consequence (a wrong sentence, a cosmetic gap) is lowered, never dropped. A verifier receives only the finding (scenario, anchor, evidence), the case file and the head SHA, never the other lenses' reports.

## Aggregator output

Two files, written by the aggregator, in `<report dir>`:

- `review.md`, the chat report:
  1. **Verdict** line. `Fix first` when any blocking finding survived verification, else `No blocking findings`, followed by the counts per severity. The verdict is never an approval and never says a change can merge: say so in one line ("This is not an approval; it lists what independent reviewers found."). Name the lenses that ran and, for a subset run, those that did not (`Lenses run: architecture, tests. Not run: spec, standards, defects, docs`).
  2. **Findings grouped by lens**, most severe first inside each: tag, `path:line` (or "review body"), the problem in two to four sentences, the fix in one or two, *Verified by*. A finding two lenses reported at the same anchor appears once, at the highest severity, with "also flagged by <lens>".
  3. **Dismissed after verification**: each refuted finding with the lens that raised it and one line of why.
  4. **Checked and sound** and **Not reviewed**, merged from the lens reports and grouped by lens. A lens that returned n/a is listed with its reason.
  5. **Proposed profile additions**, collected from the lens reports unchanged.
  6. **Draft profile**, only when the case file says the profile is `none`: a full profile built from the proposals and the repo facts in the reports. Include only what a lens observed in the repo's own files (rules, layers, records, commands, test and docs locations), each as the lens reported it. Never turn this review's findings into rules or into a review history: leave *What code review flags* as "no reviews yet", and leave a section empty rather than fill it from guesses. Use the template's heading levels.
- `review.json`, the pending-review payload for [`github.md`](github.md). Every comment's line must sit inside a hunk of the diff at the head SHA (check with `gh pr diff` or `git diff`); a finding whose anchor is `review body`, or whose line is outside every hunk, is not a comment: write it in the body under "Findings not anchored to a changed line". The body (verdict, counts, not-reviewed, dismissed-after-verification, dropped repeats) and one comment per anchored finding, each starting `**<Tag>:** (<severity>) `. A finding the verifier could not reproduce carries "second reviewer could not reproduce" in its comment.

The body never carries *Proposed profile additions* or the draft profile; those are for the chat report only. A severity the verifier lowered is applied, and the finding says "lowered from blocking by the verifier: <why>".

The lead prepends the disclosure block to the body when posting; the aggregator does not write it.

Dedupe rules: findings at the same statement or within two lines of each other in one file merge when they describe the same code defect (for example a policy breach and a behavioural consequence of the same `console.log`); the merged finding keeps the owner lens's text for the check the brief assigns it and cites the other under "also flagged by". Findings about different defects stay separate even when adjacent. *Verified by* in `review.md` is the first evidence line of the verifier's verdict for a blocking finding, and the lens's evidence otherwise; never just a lens name. State "Dismissed after verification: none" when nothing was refuted.

Dedupe, severity merging and the verdict are the aggregator's work; it reads lens reports and verdicts from files, runs no checks of its own, and adds no findings.
