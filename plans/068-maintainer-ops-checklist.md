# Plan 068: Maintainer ops checklist — leaked key, stale branches, repo security settings

> ## HUMAN-ONLY TICKET — NOT AGENT-EXECUTABLE
>
> Every action in this plan changes GitHub repository settings, deletes remote refs, or needs access to the OpenAI and GitHub admin consoles. **An agent must not execute any write command in this file.** An agent may only run the read-only verification commands (marked `read-only`) and report results. The maintainer (repo admin) runs everything else, in order, and ticks the boxes.
>
> **Readiness check (read-only, run first)**:
>
> ```bash
> gh pr view 191 --repo Ygilany/AskDB --json state -q .state    # → MERGED (CI job names below come from #191)
> gh api repos/Ygilany/AskDB/commits/main/check-runs -q '.check_runs[].name' | sort -u
> # → must include: audit, build, lint, preflight, test, unit (Node 22.12.0), unit (Node 24), react-doctor
> ```
>
> If #191 is not merged, do Parts A and C now and Part B (required checks) after it merges.

## Status

- **Priority**: P1 (Part A), P2 (Parts B–C)
- **Effort**: S (≈1 hour of console work)
- **Risk**: MED — deleting remote branches is irreversible without the SHAs recorded in A3; mis-configured required checks can block every PR.
- **Depends on**: PR #191 (CI job names) merged for Part B. Coordinate Part B with plan 067 (release pipeline) — the Version PR must be able to satisfy the same checks.
- **Category**: security
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25` (settings read via `gh api` on 2026-09-25)
- **Breaking**: No code change. Part B changes what is needed to merge to `main`.

## Why this matters

An OpenAI `sk-proj-` key was committed to `.env.example` in commit `5e20605` ("Add multi-provider AI config (OpenAI + Azure / Microsoft Foundry) (#28)", 2026-05-11). `main` was rewritten (its equivalent is `71c52a9`, same subject) so the commit is not on `main`, but it is still reachable from **53 remote branches** and **139 tags**, and — because the repo is public — anyone can read it. Separately, `main` has no required status checks, secret-scanning push protection is off, Dependabot security updates are off, and private vulnerability reporting is off even though `SECURITY.md` tells reporters to use it. None of this can be fixed from a PR.

## Current values (read-only `gh api` on 2026-09-25)

| Setting | Current value | Target |
|---|---|---|
| Leaked commit `5e20605` on `origin/main` | not an ancestor (`git merge-base --is-ancestor 5e20605 origin/main` → exit 1) | — |
| Remote branches containing `5e20605` | **53** of 194 (all heads of merged/closed PRs; **none** is an open-PR head) | 0 |
| Tags containing `5e20605` | **139** of 300 (e.g. `@askdb/config@0.3.0-beta.1`…`beta.5`) | decision in A4 |
| Classic branch protection on `main` | `404 Branch not protected` | (use the ruleset instead) |
| Ruleset `17478094` "main branch" | active on `~DEFAULT_BRANCH`: `deletion`, `non_fast_forward`, `pull_request` (0 approvals, code-owner review required, dismiss stale reviews), `code_quality`; bypass: Admin role, always; **no `required_status_checks`** | add required checks |
| Default `GITHUB_TOKEN` permissions | `default_workflow_permissions: "read"`, `can_approve_pull_request_reviews: false` | **already compliant** — record only |
| Actions: SHA pinning required | `sha_pinning_required: false`, `allowed_actions: "all"` | enable after plan 067 pins `release.yml` |
| Secret scanning | `enabled` | keep |
| Secret-scanning push protection | `disabled` | enable |
| Dependabot alerts (`vulnerability-alerts`) | enabled (HTTP 204) | keep |
| Dependabot security updates (`automated-security-fixes`) | `{"enabled":false}` | enable |
| Private vulnerability reporting | `{"enabled":false}` | enable (SECURITY.md relies on it) |
| `.github/dependabot.yml` | present after #191 (actions + npm, weekly) | keep |
| Repo description | `null` (homepage `https://askdb.tools/`, topics `[]`) | set |
| Delete head branches on merge | `false` | enable (stops stale-branch buildup) |
| `CODE_OF_CONDUCT.md` enforcement contact | the maintainer's personal email address (line 38) | a project alias |

Re-read any value with the commands in each part before changing it.

## Part A — the leaked key (P1)

### A1. Confirm the key is revoked (OpenAI console)

1. Identify the key without printing it (`read-only`, prints only a masked form):
   ```bash
   git show 5e20605:.env.example | grep -n "sk-proj-" | sed -E 's/(sk-proj-).*(.{4})$/\1…\2/'
   ```
2. In the OpenAI dashboard (API keys, every project/org you had in May 2026) find the key whose masked suffix matches. If it still exists: **revoke it now**, and check the usage page for unexpected spend since 2026-05-11.
3. [ ] Key confirmed revoked on ____ (date). Never paste the key into an issue, PR, or chat.

Revocation is the only real control: the commit is also reachable through GitHub's `refs/pull/*` refs of merged PRs and its SHA URL, which you cannot delete yourself.

### A2. List the branches that still reach the commit (`read-only`)

```bash
git fetch --prune origin
git branch -r --contains 5e20605 | sed 's#^ *origin/##' | sort > /tmp/leak-branches.txt
wc -l < /tmp/leak-branches.txt                                     # → 53 at planning time
gh pr list --repo Ygilany/AskDB --state open --json headRefName -q '.[].headRefName' --limit 200 | sort > /tmp/open-pr-branches.txt
comm -12 /tmp/leak-branches.txt /tmp/open-pr-branches.txt          # → must be EMPTY (no open PR uses them)
grep -vx 'main' /tmp/leak-branches.txt | comm -23 - /tmp/open-pr-branches.txt > /tmp/to-delete.txt
wc -l < /tmp/to-delete.txt
```
If `comm -12` prints anything, remove those names from `/tmp/to-delete.txt` and handle those PRs individually (rebase them onto `main`).

### A3. Record SHAs, then delete (maintainer)

```bash
# Restore file: one "<branch> <sha>" per line. Keep it outside the repo.
while read -r b; do echo "$b $(git rev-parse "origin/$b")"; done < /tmp/to-delete.txt > ~/askdb-deleted-branches-2026-09.txt
cat /tmp/to-delete.txt            # eyeball the list — every name should be an old feature branch
while read -r b; do git push origin --delete "$b"; done < /tmp/to-delete.txt
git fetch --prune origin
git branch -r --contains 5e20605 | wc -l      # → 0
```
To restore one branch: `git push origin <sha>:refs/heads/<branch>` using the recorded SHA (works while your local clone still has the objects).

### A4. Tags (decision)

139 release tags (`@askdb/<pkg>@<version>`) also contain `5e20605`. Deleting them breaks release history and changelog links and doesn't remove the commit from GitHub's PR refs. **Recommended: keep the tags**; the revoked key is the control. If you still want full removal, delete the tags and ask GitHub Support to purge cached views/refs for the repository (docs: "Removing sensitive data from a repository").
[ ] Decision recorded: ____

## Part B — protect `main` with required checks (after #191)

Required check names (from `.github/workflows/ci.yml` after #191, plus `react-doctor.yml`):

| Check | Workflow / job id | Require? |
|---|---|---|
| `build` | ci.yml / `build` | yes |
| `lint` | ci.yml / `lint` | yes |
| `audit` | ci.yml / `audit` | yes |
| `unit (Node 22.12.0)` | ci.yml / `unit-node-matrix` | yes |
| `unit (Node 24)` | ci.yml / `unit-node-matrix` | yes |
| `test` | ci.yml / `test` (DB services) | yes |
| `preflight` | ci.yml / `preflight` | yes |
| `react-doctor` | react-doctor.yml / `react-doctor` (runs on every PR) | optional — it's a third-party scan; require only if it has been stable |
| `status` | changesets.yml / `status` | **no** — the workflow has a `paths:` filter, so it never reports on docs-only PRs and a required check would block them forever. Revisit only if the filter is removed. |

Commands (maintainer):
```bash
gh api repos/Ygilany/AskDB/rulesets/17478094 > /tmp/ruleset.json          # read-only backup
jq '{name, target, enforcement, conditions, bypass_actors,
     rules: (.rules + [{type: "required_status_checks", parameters: {
       strict_required_status_checks_policy: true,
       do_not_enforce_on_create: false,
       required_status_checks: [
         {context: "build", integration_id: 15368}, {context: "lint", integration_id: 15368},
         {context: "audit", integration_id: 15368}, {context: "unit (Node 22.12.0)", integration_id: 15368},
         {context: "unit (Node 24)", integration_id: 15368}, {context: "test", integration_id: 15368},
         {context: "preflight", integration_id: 15368}
       ]}}])}' /tmp/ruleset.json > /tmp/ruleset-new.json
gh api -X PUT repos/Ygilany/AskDB/rulesets/17478094 --input /tmp/ruleset-new.json
```
(`integration_id` 15368 is the GitHub Actions app. If the PUT rejects a field copied from the GET, drop that field — `jq` above keeps only writable keys.) Also decide whether Admin bypass should stay `always` or become `pull_request` only.

Verify (`read-only`): `gh api repos/Ygilany/AskDB/rulesets/17478094 -q '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'` → the seven names. Open a trivial docs-only PR and confirm it is mergeable once the seven checks pass.

[ ] Done ____

## Part C — repository security and hygiene settings (maintainer)

```bash
# Secret-scanning push protection
gh api -X PATCH repos/Ygilany/AskDB -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
# Dependabot security updates
gh api -X PUT repos/Ygilany/AskDB/automated-security-fixes
# Private vulnerability reporting (SECURITY.md tells reporters to open a private advisory)
gh api -X PUT repos/Ygilany/AskDB/private-vulnerability-reporting
# Description + delete merged branches automatically
gh api -X PATCH repos/Ygilany/AskDB -f description='Natural-language questions to validated, read-only SQL for your own database. BYO model; AskDB returns SQL, never runs it.' -F delete_branch_on_merge=true
# After plan 067 has SHA-pinned release.yml: require SHA-pinned actions
# Settings → Actions → General → "Require actions to be pinned to a full-length commit SHA"
```
(Adjust the description wording as you like; keep it one sentence.) Optionally add topics: `gh api -X PUT repos/Ygilany/AskDB/topics -f 'names[]=nl-to-sql' -f 'names[]=sql' -f 'names[]=postgres' -f 'names[]=typescript'`.

Default `GITHUB_TOKEN` is already read-only — nothing to do; just confirm: `gh api repos/Ygilany/AskDB/actions/permissions/workflow` → `"default_workflow_permissions":"read"`.

Verify (`read-only`):
```bash
gh api repos/Ygilany/AskDB -q '{description, delete_branch_on_merge, push: .security_and_analysis.secret_scanning_push_protection.status}'
gh api repos/Ygilany/AskDB/automated-security-fixes          # → {"enabled":true,...}
gh api repos/Ygilany/AskDB/private-vulnerability-reporting   # → {"enabled":true}
```

### C2. Code of Conduct contact alias

`CODE_OF_CONDUCT.md` line 38 names a personal email address as the enforcement contact. Create a project alias (e.g. `conduct@askdb.tools`, forwarded to the maintainer), then change that line in a small docs PR (an agent can make that one-line edit once you give it the alias). While there, update `SECURITY.md`'s reporting section to say private vulnerability reporting is enabled and link `https://github.com/Ygilany/AskDB/security/advisories/new`.

[ ] Alias created ____ [ ] PR merged ____

## Done criteria

- [ ] A1: key revoked (date recorded)
- [ ] A2/A3: `git branch -r --contains 5e20605 | wc -l` → 0 after `git fetch --prune`; restore file saved
- [ ] A4: tag decision recorded
- [ ] B: ruleset lists the seven required checks; a docs-only PR can still merge
- [ ] C: push protection enabled, Dependabot security updates enabled, private vulnerability reporting enabled, description set, delete-branch-on-merge on
- [ ] C2: CODE_OF_CONDUCT contact is an alias
- [ ] `plans/README.md` row updated with the date

## STOP conditions (for anyone assisting)

- An agent is about to run a non-`read-only` command from this file — stop; hand it to the maintainer.
- `comm -12` in A2 is non-empty and you're unsure whether that PR is still wanted.
- A required-check name in the readiness output differs from the table (e.g. the matrix label changed) — use the live names, not this table.
- The ruleset PUT returns an error you don't understand — restore from `/tmp/ruleset.json` and stop.

## Maintenance notes

- If CI job names change (e.g. new Node versions in the matrix), update the ruleset in the same PR's follow-up, or PRs will wait forever on a check that no longer exists.
- Plan 067's Version PR is opened by a GitHub App so these required checks actually run on it.
- `delete_branch_on_merge` prevents a repeat of the 190+ stale remote branches.
