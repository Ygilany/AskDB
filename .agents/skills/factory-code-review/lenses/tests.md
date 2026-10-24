# Tests lens

Tier: standard

**Question:** would these tests fail if the code were wrong? A test that cannot fail is worse than no test, because it reads as proof.

**Reads:** the diff's test files and the production code they cover, the module's existing tests, the CI workflow files, the profile's *Tests* section (how to run one test by name, how to install dependencies in a scratch worktree, env vars and services tests need, what CI sets), and its *What code review flags*.

**Sibling skill.** When `factory-test-audit` is installed beside this skill, read its `SKILL.md`: the *Authoring gate*, *Junk patterns*, *Retention bar* and *Candidate evidence* sections are this lens's fuller rubric, and its junk list overrides the short list below where they differ. Do not use its audit workflow or campaign mode; this lens reports findings and edits nothing. Without it, the built-in rubric below is enough.

## Checks

1. **Missing tests.** A new public or user-facing contract (API route, CLI flag, exported function, config key, error code) with no test at all.
2. **Red on the old code**, when the diff adds or changes tests. Each new or changed test fails on the pre-fix code, for the stated reason. Check them one at a time in **your own** scratch worktree at the head SHA, removed when you are done (other lenses share the case file's worktree and must not see your edits):
   - **Dependencies.** A fresh worktree has none. Install them with the command the profile's *Tests* section names for a scratch worktree, and with nothing else; when it names none, skip this check and write "red on the old code: not run: dependencies" under *Not reviewed*. An install can rewire links shared with the main checkout (pnpm has left a main checkout's symlinks pointing into a reviewer's temp directory), so undo it as the profile says before you remove the worktree.
   - **Old code, new tests.** Return the non-test files to the base: restore the ones the diff modified or deleted, and delete the ones it added, which the base lacks and `git checkout` rejects (`did not match any file(s) known to git`):
     ```bash
     git diff -z --name-only --no-renames --diff-filter=a <merge-base> <sha> -- <non-test paths> | xargs -0 -r git checkout <merge-base> --
     git diff -z --name-only --no-renames --diff-filter=A <merge-base> <sha> -- <non-test paths> | xargs -0 -r rm --
     ```
   - **Run.** Run each test by name and read the failure message. A test that passes on the old code, or fails for an unrelated reason (import error, missing fixture), proves nothing.
3. **Specific assertions.** Assert the exact error code, message or value, never merely "it threw" or "it was rejected by something".
4. **Owner boundary.** Test the behaviour where users hit it (the API route, CLI command, public function), not only an internal helper the entry point might bypass. A test that would break under behaviour-preserving refactoring asserts implementation, not behaviour.
5. **Runs in CI.** Tests gated on an env var, platform or tag that skip silently when the condition is absent are findings unless CI sets the condition. Read the workflow files.
6. **Junk tests.** Assertion-free coverage probes; self-comparisons; expected values produced by the helper under test; mocks that implement the asserted behaviour; negative controls that pass for an unrelated reason (a denial from a different guard); names that promise more than the input exercises; tests whose only purpose is preserving a test-only export; a test-only setter building state production can't reach; a fallback in a helper hiding the bug; an expected-failure wrapper swallowing setup errors.

## Severity

- A test the diff relies on to prove a fix that passes on the old code or cannot fail: **blocking**.
- A new contract with no test, a skip that CI never satisfies, a vague assertion: **should fix**.
- A junk test that proves nothing but breaks nothing: **should fix** when it adds maintenance cost, **nit** otherwise.

## Does not own

Whether the fix itself is right (Defects), whether a test file follows layout conventions (Standards).

Tag: **Tests:**
