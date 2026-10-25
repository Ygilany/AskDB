# Review loop

One review is the default. A loop (review, fix, review again) runs when the user asks for one ("until clean", "keep going until no more issues") or a caller does, such as a pipeline stage that gates on review. The lead runs it and **converges** it: every loop has an exit, a cap and a stop-and-ask, stated in its first line ("Looping until a round has no blocking findings, at most 3 rounds").

A **round** is one review followed by its fixes.

## Bounds

- **Exit:** a round whose final report has zero blocking findings. Should-fix findings and nits are fixed or answered in the same pass and never start another round. A user's "until no more issues" means this exit. A stricter bar, stated explicitly (for example no should-fix findings), replaces it.
- **Cap:** the profile's `Max rounds:` line, else 3. At the cap with a blocking finding standing, stop and report it.
- **Stop and ask**, when any of these holds:
  - two rounds in a row do not lower blocking plus should-fix findings;
  - the same class of finding returns three rounds running (a new way round the same check each time): the design cannot converge, so propose a design change in place of another fix;
  - the lead needs a decision from the user that would change the exit, the cap or the design.

  Stopping means: finish and post the round in flight, send the decision with a recommendation, dispatch nothing more. "I'll keep fixing until you say otherwise" is the failure this rule exists to prevent: waiting costs nothing, and a loop left running unattended for a night costs hundreds of agent runs.

## Round steps

1. **Review.** Round 1 reviews the whole target with every lens. From round 2 the diff command is `<last reviewed head>..<head>` and the lenses are the ones the fixes touch: code fixes bring in defects and tests, doc fixes docs, a new file or module architecture. The case file's prior findings hold every earlier round's findings and the response to each.
2. **Confirm.** A range round that finds zero blocking findings is followed by one full pass: every lens over the whole target diff, because range rounds cannot see a regression in code the fixes left alone. That pass counts as a round. It exits when it has zero blocking findings; otherwise the loop continues in range mode.
3. **Post.** Each round posts as `COMMENT`, or stays in chat. A pending review left by one round stops the next ([`github.md`](github.md), *Check for an existing pending review*).
4. **Fix.** Blocking and should-fix findings get a fix with a test that fails without it; nits get a fix or an answer on their thread. The lead wrote the fixes: every review body says so.
5. **Decide.** Apply the bounds above, then start the next round.
