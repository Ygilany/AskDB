# Refreshing the `npm:latest` baseline

The lab's committed `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` pin what `npm install askdb` resolves (decision 2 in [`docs/specs/consumer-lab.md`](../../../docs/specs/consumer-lab.md)). After a release ships, refresh them in their own PR, and check the matrix for cells the release should have changed. Paths below are from the repo root.

The `Consumer lab (published)` workflow runs after each release that publishes. Its job summary already says whether the baseline is stale and which pins moved, and lists the capability `n/a` cells the release should have flipped. Read it first; triaging its cells is still steps 2 and 3 ([Published packages](../../../examples/consumer-lab/README.md#published-packages)).

## 1. Refresh the three files

1. Start from `origin/main` on a new branch, with the lab on its committed baseline (`git status examples/consumer-lab` clean).
2. Run `pnpm lab:use npm:latest`. It prints every `@askdb/*` package's version, all from `registry`.
3. Run `git status --short examples/consumer-lab`. Exactly the three files may change. No change at all means the baseline already is `npm:latest`: stop, there is nothing to refresh.
4. Review the diff, which must be small enough to read:
   - `package.json`: only the AskDB direct dependencies' versions move. Third-party pins (drivers, `ai`, `@ai-sdk/openai`, `zod`, dev tools) stay as they are.
   - `pnpm-workspace.yaml`: only the lines between `# lab:use overrides begin` and `# lab:use overrides end` change, and the header still reads `# lab:use target: npm:latest`. The hand-written overrides above it (such as `deepmerge-ts`), `allowBuilds` and `minimumReleaseAgeExclude` are untouched. If pnpm added versioned entries to `minimumReleaseAgeExclude`, or indented the `# lab:use` comments, it rewrote the file because a version younger than a day wasn't excluded ([release age](../../../examples/consumer-lab/README.md#how-labuse-pins-the-target)): don't commit that.
   - `pnpm-lock.yaml`: `git diff --stat` and a read of the hunks show AskDB packages at their new versions, plus only the transitive packages those versions add, drop or move.
   - `grep -n "file:" examples/consumer-lab/package.json examples/consumer-lab/pnpm-workspace.yaml examples/consumer-lab/pnpm-lock.yaml` prints nothing: no tarball path is committed.

   A change outside these (a third-party version moving, a new override) means the install resolved differently from the committed state. Find out why before committing it.

## 2. Run the matrix and list the non-`pass` cells

```bash
pnpm lab:matrix
node examples/consumer-lab/src/matrix-cells.mjs
```

Triage every `FAIL` cell as [SKILL.md](SKILL.md#3-read-the-matrix) says. A cell that failed on the old baseline only because its fix wasn't released yet should now pass, if the release includes the fix (for example, the 12 `safety-*` cells that failed on `askdb@1.0.0-beta.42` pass on beta.43, which shipped their fix, #190, changeset `core-sql-lexer-hardening`).

## 3. Check each capability `n/a` cell

`node examples/consumer-lab/src/matrix-cells.mjs --status na` lists them, one group per capability. For each group, decide whether the release should have the capability:

1. Find the change that brings it: the README's [Capabilities](../../../examples/consumer-lab/README.md#capabilities-testing-older-targets) table and the detector's comment in `examples/consumer-lab/src/capabilities.ts` name it. The first cases are below.
2. Find its changeset: `gh pr view <pr> --json files --jq '.files[].path | select(startswith(".changeset/"))'`.
3. The change has shipped when both hold:
   - the changeset file has moved into `.changeset/pre/` on `origin/main`: `git cat-file -e origin/main:.changeset/pre/<id>.md` succeeds, where `<id>` is its file name without `.md` (the repo is in prerelease mode, where Changesets 3 keeps consumed changesets in `.changeset/pre/`; outside it, the changeset file is gone from `.changeset/`);
   - for each package the changeset names, its `CHANGELOG.md` on `origin/main` (under `packages/` or `apps/`) has the changeset's text under a `## <version>` heading at or below the version `lab:use npm:latest` installed. A higher version means it was versioned but not published yet.
4. Record a verdict per capability:
   - **not shipped:** its `n/a` cells are expected; say so in the PR.
   - **shipped, cells now `pass`:** the capability flipped; list the cells in the PR.
   - **shipped, cells still `n/a`:** a finding. The release lacks what its changeset promised, or the detector misreads it. Reproduce it by hand through the documented surface the detector probes, then file it ([findings](SKILL.md#4-known-failures-and-findings)) and report it in the PR.
   - **shipped, cells now `FAIL`:** the capability arrived but the scenario fails: triage it like any `FAIL`.

Done when every capability that `matrix-cells.mjs --status na` lists, and every capability in the table below, has a verdict.

The first cases: once a release includes the change, the capability's `n/a` cells must become real results. The README's Capabilities table says which scenarios each one gates.

| Capability | Arrives with |
|---|---|
| `mysql-databases` | #220 |
| `http-api-optional-drivers` | #263 (fixes #260) |
| `subtree-resolver` | #270 (fixes #232) |
| `tenant-driver-markers` | #197 (fixes #231) |
| `tenant-predicate-required` | #341 (fixes #315) |

All five shipped in `askdb@1.0.0-beta.43`, so its baseline has no `n/a` cell. They gate cells again only on an older target (`npm:askdb@<version>`).

Check `src/capabilities.ts` for the current list: a capability added since this table was written is checked the same way.

## 4. Commit and open the PR

1. In `examples/consumer-lab/known-release-failures.json`, delete the entries for releases older than the new baseline: no `npm:latest` run installs them again.
2. Stage exactly the three files, and `known-release-failures.json` if step 1 changed it: `git add examples/consumer-lab/package.json examples/consumer-lab/pnpm-workspace.yaml examples/consumer-lab/pnpm-lock.yaml`, then `git diff --cached --name-only` must print those and nothing else.
3. Commit, for example `chore(lab): refresh the npm:latest baseline to askdb@<version>`. No changeset: the lab isn't published. The installed lab now matches the commit, so `pnpm lab:use --restore` isn't needed.
4. The PR body gives the versions before and after, the `FAIL` cells and their triage, the verdict for each capability, and the findings filed, and ends with the `Thread ID:` line.
