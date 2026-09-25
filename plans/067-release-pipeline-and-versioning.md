# Plan 067: A release pipeline and versioning scheme fit for going public (1.0 RC line)

> **Executor instructions**: This plan mixes agent-executable steps with steps only a maintainer with GitHub-admin and npm-owner rights can do. Steps marked **[HUMAN]** must not be attempted by an agent — prepare the exact commands, put them in the PR description as a checklist, and stop. Follow each agent step, run every verification command, and confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> for n in 180 183 191; do gh pr view $n --repo Ygilany/AskDB --json number,state -q '"\(.number) \(.state)"'; done   # → all MERGED
> gh pr view 179 --repo Ygilany/AskDB --json state -q .state        # → OPEN or CLOSED (the maintainer has decided: supersede #179 with this plan — see Step 0)
> git grep -n "workflow_dispatch" -- .github/workflows/release.yml   # → present; problem still exists if the file has no `environment:` and uses NPM_TOKEN:
> git grep -n "NPM_TOKEN\|environment:" -- .github/workflows/release.yml
> git grep -n "onlyUpdatePeerDependentsWhenOutOfRange" -- .changeset/config.json   # → 1 match (#198 turned it on)
> node -e "const p=require('./.changeset/pre.json');console.log(p.mode,p.tag)"      # → "pre beta"
> ls packages | grep -E '^ai-(openai|anthropic|google|azure)$|^connectors$'        # → shows which deprecated shims still exist (plan 060 removes them before GA)
> ```

## Status

- **Priority**: P1 (blocks a public 1.0)
- **Effort**: M (agent part) + human setup
- **Risk**: HIGH — publishing is irreversible (npm versions can't be reused); a mis-configured `fixed` group or pre-mode transition bumps every package. Every versioning step is dry-run on a scratch branch first.
- **Depends on**: PRs #180 (CI runs the DB suites), #191 (CI hardening: SHA-pinned actions, job names), #183 (release packaging) merged; the maintainer's decision on PR #179 (Step 0); **plan 060 (remove deprecated `@askdb/ai-*` / `@askdb/connectors` shims) must land before the GA step (Step 8)**, not before the pipeline steps.
- **Category**: dx (release engineering)
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: Yes for versioning — every public package moves to the `1.0.0-rc.N` line (several jump from `0.x`). No code API changes in this plan.

## Why this matters

AskDB publishes 20 public npm packages by hand. The state at planning time (read-only checks on 2026-09-25):

- **`release.yml` has never run.** The latest versions (`@askdb/core@1.0.0-beta.42`, 2026-08-23) were published manually, without provenance attestations.
- **PR #179** (automation with `changesets/action`) has four flaws: the Version PR is opened with `GITHUB_TOKEN`, and events created by `GITHUB_TOKEN` do not trigger other workflows, so `ci.yml` never runs on the Version PR and the "CI gate" it claims does not exist; version and publish run in one job that holds both `contents: write` and npm credentials; auth is a long-lived `NPM_TOKEN` (and **the repo has no `NPM_TOKEN` secret at all** — `gh api repos/Ygilany/AskDB/actions/secrets` → `total_count: 0`); `changesets/action@v2.1.1` is tag-pinned while every other workflow is SHA-pinned since #191; `workflow_dispatch` has no branch guard; the publish path runs `pnpm test` with no database services, so the integration suites silently skip.
- **npm dist-tags are inverted** on every package: `latest` → current prerelease (e.g. `askdb` `1.0.0-beta.42`), `beta` → stale (`askdb` `0.5.0-beta.1`). There are no stable versions at all.
- **Versions are scattered**: `@askdb/core`/`askdb`/`@askdb/http-api` at `1.0.0-beta.42`, others at `0.1.0-beta.x`–`0.3.0-beta.x`, shims at `1.0.0-beta.4..6`. `.changeset/config.json` has `"linked": [["@askdb/core", "askdb", "@askdb/http-api"]]`, `"fixed": []`, no `privatePackages`, pre mode `beta` with 36 pending changesets.
- **`main` has no required status checks** (ruleset "main branch" requires a code-owner review only; see plan 068).

After this plan: a Version PR opened by a GitHub App (so CI runs on it), a publish job that only runs on `main` after full CI (with databases) passed on that exact commit, inside a protected environment, authenticating to npm with OIDC trusted publishing (no stored token, provenance by default), all packages on one `1.0.0-rc.N` version, correct dist-tags, and a migration guide for 1.0.

## Current state

### Workflows (on `c7404d4`)

- `.github/workflows/release.yml`: `on: workflow_dispatch`; `permissions: contents: read, id-token: write`; one job `publish`: `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v6` (`node-version: 22`, `registry-url`), install, `pnpm -r build`, `pnpm test`, `pnpm smoke:install`, `pnpm -r publish --dry-run --no-git-checks --access=public`, then `pnpm changeset publish` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, `NPM_CONFIG_PROVENANCE: "true"`.
- `.github/workflows/ci.yml`: `name: CI`; `on: push: branches: [main]` and `pull_request`; `concurrency: group: ci-${{ github.ref }}`; `permissions: contents: read`; jobs `build`, `lint`, `audit`, `unit-node-matrix` (checks named `unit (Node 22.12.0)` / `unit (Node 24)`), `test` (pgvector, MySQL, SQL Server services + Pagila, `ASKDB_REQUIRE_INTEGRATION: "1"`), `preflight` (`pnpm smoke:install` + publish dry-run). All actions SHA-pinned with a `# vX.Y.Z` comment — copy that style.
- `.github/workflows/changesets.yml`: job `status`, `pull_request` with a `paths:` filter, runs `pnpm changeset status --since=origin/${{ github.base_ref }}`.
- PR #179's proposal (read it: `gh pr diff 179 --repo Ygilany/AskDB`): single `release` job on `push: main` + `workflow_dispatch`, `changesets/action@v2.1.1` with `version-script: pnpm version-packages`, `publish-script: pnpm release`, `create-github-releases: false`; root scripts `"version-packages": "changeset version && pnpm install --lockfile-only"` and `"release": "pnpm -r build && pnpm test && pnpm smoke:install && pnpm -r publish --dry-run --no-git-checks --access=public && changeset publish"`. It also fixes the header of `scripts/release-preflight.sh` (preflight must not run on the Version Packages branch because `changeset status` fails there) — keep that fix.

### Root `package.json`

`"packageManager": "pnpm@11.22.0"`, `"engines": { "node": ">=22.12" }`, scripts `"changeset": "changeset"`, `"release": "pnpm -r build && changeset publish"`, `"smoke:install"`, `"preflight": "bash scripts/release-preflight.sh"`. `@changesets/cli` 2.31.1. Node 22 ships npm 10.x; **npm trusted publishing (OIDC) needs npm ≥ 11.5.1** — the publish job must use Node 24 or install a newer npm.

### Changesets

`.changeset/config.json`:
```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [["@askdb/core", "askdb", "@askdb/http-api"]],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH": { "onlyUpdatePeerDependentsWhenOutOfRange": true }
}
```
`onlyUpdatePeerDependentsWhenOutOfRange` was introduced by commit `264843a` ("chore(changeset): collapse-ai-adapters; bump peer dependents only when out of range", from #198). `.changeset/pre.json`: `mode: "pre"`, `tag: "beta"`, 140 consumed changesets; 36 pending.

Private workspace packages: `@askdb/docs-site` (`apps/docs-site`, **matches the glob `@askdb/*`**), `askdb-ask-question-example`, `askdb-express-server-example`.

Pending changesets that look internal-only (verify each body before acting): empty frontmatter `ci-run-integration-tests`, `test-audit-ai`, `test-audit-apps`, `test-audit-core`, `test-audit-db`; bump-a-package-but-internal `rag-cli-mock-embedder-internal` ("Internal: … never reachable"), `studio-drop-dead-redact-url`, `docs-safety-honesty` ("Documentation-only"). Keep `remove-driver-cache-test-seams` (it touches `OptionalDriverLoader.reset()` in the public `@askdb/introspect/kit` subpath).

### npm (read-only `npm view <pkg> dist-tags`, 2026-09-25)

Every public package: `latest` = newest prerelease, `beta` = an old version (e.g. `@askdb/core` latest `1.0.0-beta.42` / beta `0.5.0-beta.0`; `@askdb/studio` `0.2.0-beta.35` / `0.2.0-beta.1`). No package has a non-prerelease version. The shims (`@askdb/ai-openai`, `ai-anthropic`, `ai-google`, `ai-azure`, `@askdb/connectors`) are not `npm deprecate`d. Only npm maintainer: `ygilany`.

### Docs

No migration/upgrade guide exists (`git grep -il "migrat\|upgrad" -- apps/docs-site/src/content/docs docs` finds only unrelated pages). `apps/docs-site/src/content/docs/guides/bring-your-own-model.mdx` and `reference/packages.mdx` still mention `ai-openai` / `@askdb/connectors`. Every package has a `CHANGELOG.md`; there is no root changelog and zero GitHub Releases (300 tags).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Gates | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 (preflight's last step is `pnpm changeset status`) |
| Changeset plan | `pnpm changeset status --verbose` | lists planned bumps; no errors |
| Workflow lint | `pnpm dlx @action-validator/cli .github/workflows/release.yml` (or `actionlint` if installed) | no errors |
| Resolve an action SHA | `gh api repos/<owner>/<repo>/commits/<tag> -q .sha` | 40-hex SHA |
| Docs | `pnpm docs:build` | exit 0 |

## Scope

**In scope**: `.github/workflows/release.yml`, `.changeset/config.json`, `.changeset/pre.json` (via `changeset pre` commands only), `.changeset/*.md` (deleting internal-only ones), root `package.json` (scripts; exact-pin `@changesets/cli` in `devDependencies`), `scripts/release-preflight.sh` (header fix from #179), `apps/docs-site/package.json` (name — Step 3's rename) and `pnpm-lock.yaml`, `apps/docs-site/src/content/docs/guides/upgrade-to-1-0.mdx` (create), `apps/docs-site/astro.config.*` sidebar entry if pages are listed explicitly, `docs/releases/1.0.0.md` (create; curated notes), `CONTRIBUTING.md` (add a short "Releasing" section after the release-checks section — there is no `RELEASING.md`), `docs/specs/distribution.md` (its "Out of scope: Automated npm publish in CI (manual maintainer step…)" line becomes false; move it to in-scope with a pointer to `release.yml`).

**Out of scope**: `.github/workflows/ci.yml` (the release workflow consumes its result via `workflow_run`; don't add `workflow_call` or change its jobs — plan 068 relies on its check names); removing the shim packages (plan 060); repo settings, branch protection, environments, secrets, npm settings (all **[HUMAN]**, and plan 068 covers branch protection); any package source code; publishing anything from an agent session.

## Git workflow

- Branch: `plan/067-release-pipeline-and-versioning`
- Conventional commits: `ci(release): …`, `chore(changeset): …`, `docs: …`
- One PR; do not merge. Put every **[HUMAN]** command in the PR description as an ordered checklist.

## Steps

### Step 0 [HUMAN]: decide PR #179's fate

Recommended: close #179 with a comment linking this plan's PR ("superseded: needs App token, split jobs, OIDC, SHA pins, main guard"). Keep its `scripts/release-preflight.sh` header fix and `version-packages` script — this plan re-applies both. Agent: do not comment on or close #179.

### Step 1 [HUMAN]: GitHub and npm prerequisites (the agent writes these into the PR description)

1. **GitHub App** for release PRs: create a private App on the `Ygilany` account with repository permissions *Contents: Read & write*, *Pull requests: Read & write*, install it on `Ygilany/AskDB` only; store `RELEASE_APP_ID` (variable) and `RELEASE_APP_PRIVATE_KEY` (secret). Events created with an App installation token do trigger `ci.yml`, which is the point.
2. **Environment** `npm-publish`: Settings → Environments → new; *Required reviewers*: the maintainer; *Deployment branches*: selected branches → `main` only. No secrets needed.
3. **npm trusted publishing**, for **each** public package (list: `pnpm -r --filter "!./apps/docs-site" --filter "!./examples/**" exec node -p "require('./package.json').name"`): npmjs.com → package → Settings → Trusted publisher → GitHub Actions: owner `Ygilany`, repository `AskDB`, workflow filename `release.yml`, environment `npm-publish`. Then, per package, set *Publishing access* to "Require two-factor authentication and disallow tokens" once the first OIDC publish succeeded.
4. Ruleset: add the required checks from plan 068 so the Version PR can't merge red.

### Step 2: Rewrite `release.yml` (agent)

Design — three jobs, least privilege, gated on CI having passed **on the same commit**:

```yaml
name: Release
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
permissions: {}
concurrency:
  group: release
  cancel-in-progress: false
jobs:
  version:
    # Only after a green CI run for a push to main (full DB suites ran on this exact SHA).
    if: >-
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main'
    runs-on: ubuntu-latest
    permissions: { contents: read }
    outputs:
      hasChangesets: ${{ steps.changesets.outputs.hasChangesets }}
    steps:
      - id: app-token
        uses: actions/create-github-app-token@<SHA> # vX
        with: { app-id: ${{ vars.RELEASE_APP_ID }}, private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }} }
      - uses: actions/checkout@<SHA as in ci.yml> # v6.1.0
        with: { ref: ${{ github.event.workflow_run.head_sha }}, fetch-depth: 0, token: ${{ steps.app-token.outputs.token }} }
      - (pnpm/action-setup, actions/setup-node node 22 with cache: pnpm — same SHAs as ci.yml)
      - run: pnpm install --frozen-lockfile
      - id: changesets
        uses: changesets/action@<SHA> # v2.1.1 — verify input/output names in action.yml at that SHA
        with: { version: pnpm version-packages, title: "chore: version packages", commit: "chore: version packages" }   # NO publish input
        env: { GITHUB_TOKEN: ${{ steps.app-token.outputs.token }} }
  publish:
    needs: version
    if: needs.version.outputs.hasChangesets == 'false'
    runs-on: ubuntu-latest
    environment: npm-publish
    permissions: { contents: read, id-token: write }
    steps:
      - uses: actions/checkout@<SHA> with { ref: ${{ github.event.workflow_run.head_sha }}, persist-credentials: false }
      - pnpm setup; actions/setup-node with node-version: 24, registry-url: https://registry.npmjs.org
      - run: npm --version   # must be >= 11.5.1 for OIDC; otherwise `npm install -g npm@^11.5.1`
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - run: pnpm smoke:install
      - run: pnpm -r publish --dry-run --no-git-checks --access=public
      - run: pnpm changeset publish      # OIDC: no NODE_AUTH_TOKEN; provenance is automatic with trusted publishing
  tag:
    needs: publish
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - app token (as above); checkout head_sha with the app token
      - run: pnpm install --frozen-lockfile && pnpm changeset tag && git push --tags
```

Requirements and how to satisfy them:
- **SHA-pin** every action; resolve with `gh api repos/changesets/action/commits/v2.1.1 -q .sha`, `gh api repos/actions/create-github-app-token/commits/<latest v-tag> -q .sha`; reuse the exact `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` SHAs already in `ci.yml`. Keep the `# vX.Y.Z` comment.
- **Read `action.yml` of `changesets/action` at the pinned SHA** (`gh api repos/changesets/action/contents/action.yml?ref=<SHA> -q .content | base64 -d`) and use its real input and output names (v1 used `version`/`publish`/`hasChangesets`; #179 used kebab-case `version-script` for v2). If the output that signals "no pending changesets" is not named `hasChangesets`, use the real name in `outputs:` and the `if:`.
- **Main guard**: `workflow_run` + the three `if` conditions; the `npm-publish` environment's branch policy (Step 1) is the second guard. No `workflow_dispatch` (a manual re-run is "Re-run jobs" on the workflow run).
- **Tests with DBs**: not re-run here on purpose — `workflow_run` only fires after `CI` (which includes the `test` job with services and `ASKDB_REQUIRE_INTEGRATION=1`) concluded `success` for that SHA. Say so in a comment at the top of the file.
- **Whether pnpm's publish path honors OIDC**: `changeset publish` shells out to the workspace package manager. Before relying on it, check pnpm 11's docs/changelog for trusted-publishing/OIDC support (`pnpm publish --help`, https://pnpm.io). If pnpm cannot do OIDC, change the publish step to `pnpm -r exec -- npm publish --access public` guarded by a version-exists check, or set `"publishConfig"`-compatible alternatives — and STOP to report if neither is clean.
- Root `package.json`: add `"version-packages": "changeset version && pnpm install --lockfile-only"`; set `"release": "pnpm -r build && changeset publish"` (unchanged) — the workflow calls steps individually.
- Apply #179's `scripts/release-preflight.sh` header fix (`gh pr diff 179 --repo Ygilany/AskDB -- scripts/release-preflight.sh`).

**Verify**: `git grep -nE "uses: [^ ]+@v[0-9]" -- .github/workflows/release.yml` → no matches (all SHA-pinned); `git grep -n "NPM_TOKEN\|NODE_AUTH_TOKEN" -- .github/workflows/release.yml` → none; `git grep -n "id-token: write" -- .github/workflows/release.yml` → exactly one (publish job); workflow validator → no errors.

### Step 3: Changesets config (agent, dry-run first)

Target `.changeset/config.json`:
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.4/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["askdb", "@askdb/*"]],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": { "version": false, "tag": false },
  "___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH": { "onlyUpdatePeerDependentsWhenOutOfRange": true }
}
```
- `linked` must be emptied: the three packages are inside the fixed group now.
- **Keep** `onlyUpdatePeerDependentsWhenOutOfRange`: with `fixed` all packages move together anyway, and it prevents spurious peer-dependent majors if a package ever leaves the group. It is an experimental option ("WILL_CHANGE_IN_PATCH"): pin `@changesets/cli` exactly (`2.31.1`, no caret) in root `devDependencies` so an upgrade can't silently change it, and add a comment in the PR.
- `@askdb/docs-site` matches `@askdb/*`. Prefer renaming it to `askdb-docs-site` in `apps/docs-site/package.json` (it is private; check `git grep -n "@askdb/docs-site" -- ':!**/CHANGELOG.md' ':!.changeset/**' ':!pnpm-lock.yaml'` → only `apps/docs-site/package.json`, so the rename is safe; then `pnpm install` to refresh the lockfile). Rationale: avoids relying on how changesets treats a private package inside a fixed glob.

**Verify (scratch, never committed)**: `git switch -c scratch/067-dryrun` → apply config → `pnpm changeset status --verbose` → no config errors, every public package listed with the same new version, `askdb-docs-site` and examples not listed. `git switch -` and delete the scratch branch.

### Step 4: Curate pending changesets (agent proposes, [HUMAN] approves)

List pending ones: `node -e "const p=require('./.changeset/pre.json');const fs=require('fs');const done=new Set(p.changesets);console.log(fs.readdirSync('.changeset').filter(f=>f.endsWith('.md')&&f!=='README.md'&&!done.has(f.slice(0,-3))).join('\n'))"`. Delete the empty-frontmatter ones (`ci-run-integration-tests`, `test-audit-*`) and the internal-only ones named in Current state **after confirming each body**; keep everything user-facing. List deletions in the PR description for the maintainer to confirm.

**Verify**: `pnpm changeset status` → exit 0.

### Step 5: Versioning transition to the RC line (agent, dry-run; [HUMAN] commits the real one)

Commit to 1.x: every public package becomes `1.0.0-rc.0`.

```bash
git switch -c scratch/067-rc
pnpm changeset pre exit
pnpm changeset pre enter rc
pnpm changeset version          # dry run on scratch only
git diff --stat                 # inspect
node -e "for (const d of ['packages','apps']) for (const n of require('fs').readdirSync(d)) { try { const p=require('./'+d+'/'+n+'/package.json'); if(!p.private) console.log(p.name, p.version) } catch {} }"
```
Expected: every public package `1.0.0-rc.0`; `pre.json` `mode: "pre"`, `tag: "rc"`, `initialVersions` = the pre-transition versions, `changesets` still listing the already-consumed beta ids. If any package lands elsewhere (e.g. `0.x-rc.0` or `2.0.0-rc.0`), STOP. Then discard the scratch branch. In the real PR commit only `pre exit` + `pre enter rc` (the `pre.json` change) and the config — **not** the `changeset version` output; the release pipeline's Version PR produces that.

### Step 6: Migration guide and curated 1.0 notes (agent)

- Create `apps/docs-site/src/content/docs/guides/upgrade-to-1-0.mdx` (match frontmatter/sidebar conventions of a sibling guide; add to the sidebar if `astro.config.*` lists guides explicitly). One section per breaking change, each with before/after code **verified against the changeset that introduced it** (read the `.changeset/*.md` bodies and the code; don't invent APIs). Candidates to verify: `ai` becomes a peer of `@askdb/core` (`^6 || ^7`, #196); `@askdb/ai-*` folded into `@askdb/ai` built-in providers (#198) and the shim packages removed (plan 060); `@askdb/connectors` replaced by the registry in `@askdb/introspect` (#199, ADR 0008); `tenantFilters` removed and `subtree` scope rejected (#197); tenant enforcement fails closed (#186); stricter SQL lexer may reject SQL previously accepted (#190); Studio execute is opt-in and no longer reuses the introspection connection by default (#194); HTTP API `allowSchemaOverride` defaults to `false` (#187); Node ≥ 22.12 (#183).
- Fix `guides/bring-your-own-model.mdx` and `reference/packages.mdx` references to removed packages **only if plan 060 has landed**; otherwise leave a TODO in the PR description.
- Create `docs/releases/1.0.0.md`: curated notes (highlights, breaking changes linking to the guide, security hardening summary from `docs/reviews/2026-09-25-architecture-and-release-review.md`). The maintainer pastes it into the GitHub Release for `askdb@1.0.0`.

**Verify**: `pnpm docs:build` → exit 0.

### Step 7 [HUMAN]: repair npm dist-tags (commands prepared by the agent)

For each public package, point `beta` at the newest beta so `npm i <pkg>@beta` stops resolving stale versions (`latest` stays where it is until GA):
```bash
for p in askdb @askdb/core @askdb/http-api @askdb/studio @askdb/client @askdb/ai @askdb/config @askdb/enrich @askdb/introspect @askdb/mysql @askdb/postgres @askdb/prisma @askdb/rag @askdb/sqlite @askdb/sqlserver @askdb/ai-openai @askdb/ai-anthropic @askdb/ai-google @askdb/ai-azure @askdb/connectors; do
  v=$(npm view "$p" dist-tags.latest); echo "$p beta -> $v"; npm dist-tag add "$p@$v" beta
done
```
After the first RC publishes under the `rc` tag: `npm view <pkg> dist-tags` must show `rc: 1.0.0-rc.0`. At GA, `latest` moves automatically when `1.0.0` is published without a pre tag. When plan 060 lands: `npm deprecate "@askdb/ai-openai@*" "Built into @askdb/ai since 1.0 — see https://askdb.tools/guides/upgrade-to-1-0/"` (and likewise for the other shims).

### Step 8 [HUMAN]: GA

Only after plan 060 is merged and at least one RC has been used: `pnpm changeset pre exit`, merge the resulting Version PR, let the pipeline publish `1.0.0` (dist-tag `latest`), create the GitHub Release from `docs/releases/1.0.0.md`.

## Test plan

No unit tests (CI/config only). Verification is: workflow validation, the scratch-branch `changeset status`/`changeset version` dry runs (Steps 3 and 5), `pnpm preflight`, and — after the human steps — the first real run: the Version PR must show the CI checks running (proves the App token), and the publish job must pause for environment approval and publish with provenance (`npm view @askdb/core@1.0.0-rc.0 dist.attestations` non-empty).

## Docs impact

New `guides/upgrade-to-1-0.mdx`; a "Releasing" section in `CONTRIBUTING.md` describing the Version PR → approval → OIDC publish flow and the `rc` tag; `docs/specs/distribution.md` updated (automated publish is now in scope); `docs/releases/1.0.0.md`.

## Changeset guidance

No changeset for workflow/config changes. The `pre exit`/`pre enter rc` transition is itself the versioning change. After Step 5, `pnpm changeset status` must show every public package at the same next version; any **major** beyond `1.0.0-rc.*` is a STOP.

## Done criteria

- [ ] `release.yml` has jobs `version`, `publish`, `tag`; triggered by `workflow_run` of `CI` on `main`; only `publish` has `id-token: write`; `publish` uses `environment: npm-publish`; no `NPM_TOKEN`; every `uses:` is SHA-pinned
- [ ] `.changeset/config.json` matches Step 3; `@changesets/cli` pinned exactly
- [ ] `.changeset/pre.json` has `mode: "pre"`, `tag: "rc"`
- [ ] Scratch dry run recorded in the PR: all public packages → `1.0.0-rc.0`, private ones untouched
- [ ] `apps/docs-site/src/content/docs/guides/upgrade-to-1-0.mdx` and `docs/releases/1.0.0.md` exist; `pnpm docs:build` exits 0
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm smoke:install && pnpm preflight` exit 0
- [ ] PR description contains the [HUMAN] checklist (Steps 0, 1, 4 approval, 7, 8) with exact commands

## STOP conditions

- The `changesets/action` at the pinned SHA has no "has changesets" output, or its version mode can't run without publish credentials.
- pnpm's `changeset publish` path can't authenticate with OIDC and there's no clean alternative (Step 2).
- `changeset status`/`version` errors on the new config, or the dry run produces anything other than `1.0.0-rc.0` for every public package.
- Any step would require creating secrets, environments, Apps, npm settings, or publishing — those are [HUMAN].
- Plan 060 hasn't landed and you reach Step 8.

## Maintenance notes

- `workflow_run` always uses the workflow file from the default branch; changes to `release.yml` only take effect after merging to `main`.
- If `ci.yml` is renamed (its `name: CI`), update `workflows: [CI]` here.
- Once on `1.x`, a breaking change is a **major** changeset; the pre-1.0 "breaking = minor" convention in `AGENTS.md` should be updated in the GA PR.
- Reviewer focus: permissions per job, the three `if` guards, that the publish job checks out `workflow_run.head_sha` (not `main` HEAD), and the dry-run output.
