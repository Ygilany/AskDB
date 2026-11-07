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

Twelve packages are on the 1.0 line and share one version: `askdb`, `@askdb/ai`, `@askdb/client`, `@askdb/config`, `@askdb/core`, `@askdb/http-api`, `@askdb/introspect`, `@askdb/mysql`, `@askdb/postgres`, `@askdb/prisma`, `@askdb/sqlite` and `@askdb/sqlserver`. They are the `fixed` group in `.changeset/config.json`, so every release publishes all 12 at the same version, even a package that didn't change. `@askdb/studio`, `@askdb/enrich` and `@askdb/rag` stay on `0.x`, outside the group.

- **A breaking change to one of the 12** is a `major` changeset. From `1.0.0` on, a major in any of the 12 moves all 12 to the next major. Between `1.0.0-rc.1` and `1.0.0` the public API is frozen ([ADR 0030](adrs/0030-1-0-promises-checked-sql-only.md), [ADR 0031](adrs/0031-unused-exports-leave-before-1-0.md)), so a breaking change there needs the maintainer's decision. The tooling doesn't stop one: in pre mode any bump only raises the `rc` number.
- **A breaking change confined to an experimental surface** in the 1.0 set (the `studio` and `rag` config blocks, the `askdb studio`, `enrich`, `bundle` and `rag` commands, `askdb init`'s RAG and Studio flags, and the `@askdb/config/scaffold` entry point; [ADR 0030](adrs/0030-1-0-promises-checked-sql-only.md)) is a `minor` changeset naming `askdb` or `@askdb/config`.
- **A breaking change to Studio, `@askdb/enrich` or `@askdb/rag`** is a `minor` changeset. Never give one of them a `major`: it would move that package to 1.0.

Before merging a Version PR, confirm its versions show no unintended major. `pnpm changeset status` is not the place to check the prerelease number: right after a pre-tag change it shows the old counter (`1.0.0-rc.47`), because only `pnpm version-packages` restarts it (see [Prerelease Lines](#prerelease-lines)).

## Publish Flow

Releases run in `.github/workflows/release.yml`, triggered when `CI` passes on a push to `main`.

1. Merge feature PRs with changesets. `changesets.yml` requires one on any PR that changes publishable sources other than test files (`*.test.*`, `*.spec.*`, `__tests__/`, `__snapshots__/`, `test-utils.ts`; see `scripts/publishable-paths.sh`).
2. The `version` job opens or updates the **"chore: version packages (rc)"** PR on the `changeset-release/main` branch; the action adds the pre tag from `.changeset/pre.json` to the title. It runs `pnpm version-packages`, which applies every pending changeset: version bumps and CHANGELOG entries. In prerelease mode, Changesets 3 then moves each consumed changeset into `.changeset/pre/`; `.changeset/pre.json` keeps only the mode and the pre tag.
3. Review that PR's versions and changelogs and approve it. Your approval is the release approval: nothing asks again after the merge, whether you merge it, auto-merge does, or an agent does after your approval. CI runs on it like any PR; `changesets.yml` skips its changeset and version checks there, because the PR applies changesets rather than adding one.
4. When CI passes on the merge commit, the `publish` job builds and runs `pnpm -r publish --access public --tag latest`, which publishes every public package whose version isn't on npm yet.
5. The `tag` job pushes a `<name>@<version>` git tag for each published package.
6. Check the package pages, and install one package from npm in a clean directory.
7. Publish a GitHub Release for the new `askdb@<version>` tag, by hand. Its body lists each breaking change in one line, and links the release's section of the [upgrade notes](../apps/docs-site/src/content/docs/guides/upgrading.mdx) (askdb.tools/guides/upgrading/) and the package CHANGELOGs. Add that section before the Version PR merges, so the Release has something to link. While AskDB publishes prereleases (betas, then release candidates), mark the Release pre-release. Write the body to an untracked file, such as `release-notes.md` outside the repo, then run:

   ```bash
   gh release create askdb@<version> --verify-tag --prerelease \
     --title "askdb <version>" --notes-file release-notes.md
   ```

   Other packages' tags get no Release. `askdb` depends on every other published package except `@askdb/http-api`, so a release publishes a new `askdb` unless it changes only `@askdb/http-api`. Such a release gets no Release of its own: if it has a breaking change, add an upgrade-notes section named after its `@askdb/http-api` version.

A push to `main` with nothing new to publish doesn't start a publish: `scripts/release-unpublished.mjs` compares every public package's version with npm first. If a publish fails partway, use "Re-run failed jobs" on the run; versions already on npm are skipped.

A new public package can't go through the Version PR: `changesets.yml` fails the PR that adds it until its first version is on npm, and the pipeline can only publish a package that has a trusted publisher. Publish that first version by hand (see [Publishing by Hand](#publishing-by-hand)), set up its trusted publisher ([One-Time Setup](#one-time-setup) step 3), then merge the PR.

The workflow only acts when the commit CI tested is still the tip of `main`. If another PR merges before CI finishes, that newer commit's CI run triggers the release instead.

After a publish, the **Consumer lab (published)** workflow (`.github/workflows/consumer-lab-published.yml`) runs the [consumer lab](../examples/consumer-lab/README.md#published-packages) against `npm:latest` from the released commit. A failure there is the release's: triage it with the [`consumer-lab` skill](../.agents/skills/consumer-lab/SKILL.md). Its job summary also says whether the lab's committed baseline is stale; refresh it as [`baseline-refresh.md`](../.agents/skills/consumer-lab/baseline-refresh.md) says.

## Dependency Updates

Published ranges move only on purpose ([ADR 0015](adrs/0015-published-ranges-move-on-purpose.md)), so Dependabot's minor and patch groups change only `pnpm-lock.yaml` and need no changeset. A major update has to rewrite a range in the manifests:

- When it changes only `devDependencies`, hosts install nothing new. `changesets.yml` doesn't count a `package.json` change confined to `devDependencies`, so the PR needs no changeset.
- When it changes a range hosts install, like a published package's `dependencies` or `peerDependencies`, the changeset check fails until you push a changeset to the Dependabot branch. Write it by hand and name the reason, as ADR 0015 requires, or close the PR if AskDB doesn't need the new major.

Once you push to a Dependabot branch, Dependabot stops resolving its conflicts. Rebase it by hand: `@dependabot recreate` rebuilds the PR without your commit.

## Dist-tags

Prereleases publish under `latest`: the betas did, and the release candidates do (decided 2026-11-06 in #354). So `npm install askdb` gets the newest one, and no stable version exists yet for `latest` to protect. There is no `beta` or `rc` dist-tag: the stale `beta` tag was removed on 2026-09-29 (#267). The pipeline doesn't use `changeset publish`, because in prerelease mode that would publish under the pre tag from `.changeset/pre.json`. Trusted publishing can only publish, so a second tag can't be moved afterwards without an npm token.

This changes at 1.0.0. The PR that exits pre mode also replaces the fixed `--tag latest` in both publish paths, `release.yml` and the root `release` script ([Publishing by Hand](#publishing-by-hand)): the pre tag while `.changeset/pre.json` is in pre mode, `latest` otherwise. Then a later prerelease, such as `1.1.0-beta.1`, can't take `latest` from a stable release.

## Prerelease Lines

`.changeset/pre.json` holds the prerelease mode and its tag (`rc` now). A change of line is one PR; the Version PR after it applies the change.

- **Start a new prerelease line** (beta to rc): run `pnpm changeset pre exit`, then `pnpm changeset pre enter <tag>`, and commit `.changeset/pre.json`. Changesets 3 numbers a prerelease from the current one, whatever its tag (`1.0.0-beta.46` becomes `1.0.0-rc.47`). So `pnpm version-packages` first runs `scripts/prerelease-counter.mjs reset`: each public package whose prerelease id isn't the new tag gets its counter set to 0, and the line starts at `<tag>.1`. After `changeset version`, `scripts/prerelease-counter.mjs check` fails the run if a public package still has another prerelease id: its reset version isn't on npm, and merging would publish it.
- **Leave out the old line's changesets.** At the stable release, every changeset still in `.changeset/pre/` goes into the stable CHANGELOG entry. Delete the old line's files there in the same PR, as #354 did for the betas, so `1.0.0` lists only the release candidates' changes. Each beta's entries stay under its own version.
- **Release the stable version** (rc to `1.0.0`): run `pnpm changeset pre exit`, commit `.changeset/pre.json`, and merge the Version PR that follows.

## Pipeline Decisions

Recorded 2026-09-29, in #354:

- **Version PR author:** a GitHub App, not `GITHUB_TOKEN` or a personal access token. PRs opened with `GITHUB_TOKEN` don't trigger other workflows, so the required checks would never report on the Version PR. The repository setting "Allow GitHub Actions to create and approve pull requests" stays off.
- **npm auth:** trusted publishing (OIDC). No npm token is stored in the repo. pnpm 11 does the OIDC exchange itself, and adds provenance because the repo and the packages are public.
- **Gate:** the maintainer's approval of the Version PR, decided 2026-11-06 by the maintainer (#354, #432). `.github/CODEOWNERS` names the maintainer for every path, and the `main` ruleset requires a code-owner review, so the App-authored Version PR can't merge until the maintainer approves it. `changesets.yml` fails any other PR that adds a public `name@version` npm doesn't have (a version bump, a new public package, or a package made public), so an unpublished version reaches `main` only through that PR. An admin bypass merge of the Version PR skips the approval and still publishes. An agent never approves the Version PR; it may enable auto-merge, or merge it, only after the maintainer has approved it (`AGENTS.md`). Until #432 merged, the `npm-publish` environment also had the maintainer as required reviewer, which repeated the PR review; the environment stays, limited to `main`, because every trusted publisher names it and only the `publish` job can request an OIDC token.
- **changesets/action:** v2, with Changesets CLI v3 (`@changesets/cli` pinned exactly in the root `package.json`). The pipeline started on v1 with CLI v2; Dependabot moved both (#390, #393), and #424 moved the workflow and the prerelease state with them.
- **GitHub Releases:** on for `askdb@<version>` tags only, published by hand (Publish Flow step 7). Each one summarizes the release's breaking changes and links its section of the upgrade notes (`/guides/upgrading/` on askdb.tools). Other packages' tags get none, and their CHANGELOGs and git tags stay the full record. Decided 2026-11-05 in #628; until then, Releases were off.
- **Versioning:** decided 2026-11-06 in #354 ([ADR 0035](adrs/0035-the-1-0-set-releases-as-one-version.md)). The 12 packages on the 1.0 line form one `fixed` group, and Studio, `@askdb/enrich` and `@askdb/rag` stay on `0.x` outside it (see [Version Posture](#version-posture)). The release candidates start at `1.0.0-rc.1` and publish under `latest`. The `1.0.0` CHANGELOG entry lists only the release candidates' changes. Until then, packages kept their own versions, with `@askdb/core`, `askdb` and `@askdb/http-api` linked.

## One-Time Setup

The maintainer does these once, before the first automated publish:

1. **GitHub App.** Create a private App on the `Ygilany` account with repository permissions *Contents: Read and write* and *Pull requests: Read and write*, and install it on `Ygilany/AskDB` only. Store its client ID as the Actions variable `RELEASE_APP_CLIENT_ID` and a private key as the Actions secret `RELEASE_APP_PRIVATE_KEY`.
2. **Environment.** Settings → Environments → `npm-publish`: limit deployment branches to `main`, with no required reviewers. The Version PR approval is the release gate.
3. **Trusted publisher, per package.** On npmjs.com, for each public package (the non-private ones in `pnpm -r ls --depth -1`; 15 on 2026-11-06): package → Settings → Trusted publishing → GitHub Actions. Fill in *Organization or user* `Ygilany`, *Repository* `AskDB`, *Workflow filename* `release.yml` (file name only, no path) and *Environment name* `npm-publish`. Under *Allowed actions*, include `npm publish`, not only `npm stage publish`: the workflow publishes directly. Every field is case-sensitive and must match exactly. A saved configuration can't be edited, only deleted and re-created. Each package's `repository.url` must match the GitHub repository; all of them have `git+https://github.com/Ygilany/AskDB.git`.
4. **After the first automated publish succeeds**, on each package go to Settings → Publishing access, select "Require two-factor authentication and disallow tokens", and click *Update Package Settings*. Trusted publishing keeps working, but hand publishing with a token (like the granular token used on 2026-09-29) stops working.

## Publishing by Hand

Only if the pipeline is unavailable: from a clean `main` that passed CI, run `pnpm preflight`, then `pnpm release` (build, then `pnpm -r publish --access public --tag latest`). npm asks for two-factor authentication per package, and hand publishes carry no provenance. Tag the published versions afterwards with `pnpm changeset tag && git push --tags`.

## Public Safety Note

AskDB returns generated SQL for review. It does not execute generated SQL in the current public surfaces. Any downstream execution must happen under the integrator's database roles, read-only controls, tenant policy, approval process, and audit logging.
