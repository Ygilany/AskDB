# ADR 0040 — Approving the Version PR is the release approval

## Status

Accepted (2026-11-06, maintainer decision on #354 to merge #432; the publish-time check and the agent rule settled by the coordinator on 2026-11-07, in #432's review). Implemented in `.github/workflows/changesets.yml`, `.github/workflows/release.yml`, `scripts/check-unpublished-versions.mjs`, `scripts/check-version-pr-merge.mjs`, `docs/release.md` and `AGENTS.md`.

## Context

A release had two approval points: the maintainer's review of the App-authored Version PR, and then a deployment approval on `release.yml`'s `publish` job, from the `npm-publish` environment's required reviewer. The second repeated the first. `.github/CODEOWNERS` names the maintainer for every path, and the `main` ruleset requires a code-owner review, so the Version PR can't merge until the maintainer approves it.

- **Publishing ships whatever npm lacks.** `publish` runs `pnpm -r publish`, which publishes every public package whose version isn't on npm, built from the commit CI tested on `main`. Nothing ties those versions to the Version PR.
- **The deployment approval was an accidental stop.** It showed a pending deployment, not what would publish or from which commit. When a Version PR's merge commit got no release run (its CI failed, or a later PR merged before CI finished), the next green commit published the approved versions with its own code. Only the deployment approval stood in the way, and it showed no commit or version list to check against.
- **Agents run `gh` with the maintainer's credentials.** The coordinator enables auto-merge on the Version PR, and merges it by hand when auto-merge doesn't fire (#708, #763, #855).

## Options considered

### Keep the environment's required reviewer

Two approvals per release, the second without the information to judge it. Rejected: it repeats the PR review and doesn't stop the wrong-commit publish on purpose.

### The Version PR review as the only approval, with no other change

Rejected: without the environment gate, an unpublished version that reaches `main` any other way publishes with no stop, and so does an approved Version PR's versions built from a later commit.

### The Version PR review, plus a check where versions enter `main` and one where they leave it (chosen)

- **Entry:** `changesets.yml` fails any PR but the Version PR that adds a public `name@version` npm doesn't have: a version bump, a new public package, or a package made public. It reads the public packages through the same function `release-unpublished.mjs` publishes from (`scripts/release-packages.mjs`), so every manifest format pnpm reads and symlinked manifests count.
- **Exit:** `release.yml`'s `approved` job lets `publish` run only when the commit is the merge commit of a merged `changeset-release/main` PR from this repository. It reads the commit's PRs through the GitHub API with `pull-requests: read`, in a job of its own, so the job that holds the OIDC token gains no permission.

### Also require an approving review at publish time

Not done. The ruleset already requires the code-owner review before the merge, and checking it again would repeat the ruleset and name the approver in the workflow. The one path it would close is an admin bypass merge of the Version PR itself.

## Decision

- **The maintainer's approval of the Version PR is the release approval.** Once the Version PR is approved and merged, `release.yml` publishes with no further approval. The `npm-publish` environment stays, limited to `main`, with no required reviewer: every trusted publisher names it, and it keeps OIDC to the `publish` job on `main`.
- **Only the Version PR adds unpublished versions** (the entry check), **and only its merge commit publishes them** (the exit check).
- **An agent never approves the Version PR,** even when `gh` runs with the maintainer's credentials. It may enable auto-merge on it, or merge it, only after the maintainer has approved it (`AGENTS.md`).

## Consequences

- **A refused publish needs a hand publish.** When the `approved` job refuses a commit, the approved versions are on `main` but not on npm. The maintainer publishes them by hand from the Version PR's merge commit (`docs/release.md`, "Publishing by Hand"), so what ships is what was approved.
- **A new public package's first version is published by hand** from its PR branch, before the PR merges. The entry check fails the PR until that version is on npm, and the pipeline can only publish a package that has a trusted publisher.
- **An admin bypass merge** of another PR skips the entry check, but the exit check still refuses to publish from it. An admin bypass merge of the Version PR publishes without the approval.
- **The maintainer removes the environment's required reviewer** after this lands (Settings → Environments → `npm-publish`). Until then, `publish` still waits for that approval.
- **Changing either check, or adding a publish path,** amends this ADR. The rules both checks share live in `scripts/release-packages.mjs`, with self-tests that CI's `preflight` job runs.
