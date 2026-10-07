# Release Checklist

Use this checklist before making AskDB packages public or publishing a new public version.

## Local Verification

```bash
pnpm install --frozen-lockfile
pnpm run audit
pnpm build
pnpm lint
pnpm test
pnpm smoke:install
pnpm -r publish --dry-run --no-git-checks --access=public
pnpm changeset status
```

For the full local mirror of CI release checks:

```bash
pnpm preflight
```

## Version Posture

AskDB is pre-1.0. Breaking public API changes should normally use minor changesets until the project intentionally moves a package to 1.0.

Before publishing, confirm `pnpm changeset status` does not show an unintended major bump.

## Publish Flow

Releases run in `.github/workflows/release.yml`, triggered when `CI` passes on a push to `main`.

1. Merge feature PRs with changesets. `changesets.yml` requires one on any PR that changes publishable sources.
2. The `version` job opens or updates the **"chore: version packages (beta)"** PR on the `changeset-release/main` branch. It applies every pending changeset: version bumps and CHANGELOG entries. In prerelease mode, Changesets 3 then moves each consumed changeset into `.changeset/pre/`; `.changeset/pre.json` keeps only the mode and the `beta` tag.
3. Review that PR's versions and changelogs, then merge it. CI runs on it like any PR; `changesets.yml` skips its changeset check there, because the PR applies changesets rather than adding one.
4. When CI passes on the merge commit, the `publish` job waits for approval in the `npm-publish` environment. Approve it from the workflow run. It builds and runs `pnpm -r publish --access public --tag latest`, which publishes every public package whose version isn't on npm yet.
5. The `tag` job pushes a `<name>@<version>` git tag for each published package.
6. Check the package pages, and install one package from npm in a clean directory.

A push to `main` with nothing new to publish doesn't ask for approval: `scripts/release-unpublished.mjs` compares every public package's version with npm first. If a publish fails partway, use "Re-run failed jobs" on the run; versions already on npm are skipped.

The workflow only acts when the commit CI tested is still the tip of `main`. If another PR merges before CI finishes, that newer commit's CI run triggers the release instead.

After a publish, the **Consumer lab (published)** workflow (`.github/workflows/consumer-lab-published.yml`) runs the [consumer lab](../examples/consumer-lab/README.md#published-packages) against `npm:latest` from the released commit. A failure there is the release's: triage it with the [`consumer-lab` skill](../.agents/skills/consumer-lab/SKILL.md). Its job summary also says whether the lab's committed baseline is stale; refresh it as [`baseline-refresh.md`](../.agents/skills/consumer-lab/baseline-refresh.md) says.

## Dependency Updates

Published ranges move only on purpose ([ADR 0015](adrs/0015-published-ranges-move-on-purpose.md)), so Dependabot's minor and patch groups change only `pnpm-lock.yaml` and need no changeset. A major update has to rewrite a range in the manifests:

- When it changes only `devDependencies`, hosts install nothing new. `changesets.yml` doesn't count a `package.json` change confined to `devDependencies`, so the PR needs no changeset.
- When it changes a range hosts install, like a published package's `dependencies` or `peerDependencies`, the changeset check fails until you push a changeset to the Dependabot branch. Write it by hand and name the reason, as ADR 0015 requires, or close the PR if AskDB doesn't need the new major.

Once you push to a Dependabot branch, Dependabot stops resolving its conflicts. Rebase it by hand: `@dependabot recreate` rebuilds the PR without your commit.

## Dist-tags

Betas publish under `latest`, so `npm install askdb` gets the newest beta. There is no `beta` dist-tag: it was stale and was removed on 2026-09-29 (#267). The pipeline doesn't use `changeset publish`, because in prerelease mode that would publish under the `beta` tag from `.changeset/pre.json`. Trusted publishing can only publish, so a second tag can't be moved afterwards without an npm token. Revisit this when the 1.0 release candidates start (#354).

## Pipeline Decisions

Recorded 2026-09-29, in #354:

- **Version PR author:** a GitHub App, not `GITHUB_TOKEN` or a personal access token. PRs opened with `GITHUB_TOKEN` don't trigger other workflows, so the required checks would never report on the Version PR. The repository setting "Allow GitHub Actions to create and approve pull requests" stays off.
- **npm auth:** trusted publishing (OIDC). No npm token is stored in the repo. pnpm 11 does the OIDC exchange itself, and adds provenance because the repo and the packages are public.
- **Gate:** the `npm-publish` environment, with the maintainer as required reviewer and deployments limited to `main`. Only the `publish` job can request an OIDC token.
- **changesets/action:** v2, with Changesets CLI v3 (`@changesets/cli` pinned exactly in the root `package.json`). The pipeline started on v1 with CLI v2; Dependabot moved both (#390, #393), and #424 moved the workflow and the prerelease state with them.
- **GitHub Releases:** off. Package CHANGELOGs and git tags are the release record.
- **Versioning:** unchanged. Packages keep their own versions, with `@askdb/core`, `askdb` and `@askdb/http-api` linked. One lockstep version line waits for the 1.0 release candidates (#354).

## One-Time Setup

The maintainer does these once, before the first automated publish:

1. **GitHub App.** Create a private App on the `Ygilany` account with repository permissions *Contents: Read and write* and *Pull requests: Read and write*, and install it on `Ygilany/AskDB` only. Store its client ID as the Actions variable `RELEASE_APP_CLIENT_ID` and a private key as the Actions secret `RELEASE_APP_PRIVATE_KEY`.
2. **Environment.** Settings → Environments → `npm-publish`: add yourself as required reviewer, and limit deployment branches to `main`.
3. **Trusted publisher, per package.** On npmjs.com, for each of the 20 public packages (the non-private ones in `pnpm -r ls --depth -1`): package → Settings → Trusted publishing → GitHub Actions. Fill in *Organization or user* `Ygilany`, *Repository* `AskDB`, *Workflow filename* `release.yml` (file name only, no path) and *Environment name* `npm-publish`. Under *Allowed actions*, include `npm publish`, not only `npm stage publish`: the workflow publishes directly. Every field is case-sensitive and must match exactly. A saved configuration can't be edited, only deleted and re-created. Each package's `repository.url` must match the GitHub repository; all 20 have `git+https://github.com/Ygilany/AskDB.git`.
4. **After the first automated publish succeeds**, on each package go to Settings → Publishing access, select "Require two-factor authentication and disallow tokens", and click *Update Package Settings*. Trusted publishing keeps working, but hand publishing with a token (like the granular token used on 2026-09-29) stops working.

## Publishing by Hand

Only if the pipeline is unavailable: from a clean `main` that passed CI, run `pnpm preflight`, then `pnpm release` (build, then `pnpm -r publish --access public --tag latest`). npm asks for two-factor authentication per package, and hand publishes carry no provenance. Tag the published versions afterwards with `pnpm changeset tag && git push --tags`.

## Public Safety Note

AskDB returns generated SQL for review. It does not execute generated SQL in the current public surfaces. Any downstream execution must happen under the integrator's database roles, read-only controls, tenant policy, approval process, and audit logging.
