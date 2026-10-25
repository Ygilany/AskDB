# Spec: make the dependency audit pass on `main` again (#466)

## For the owner

This spec makes `pnpm run audit` exit 0 on `main` by fixing the advisories it reports when build runs (on 2026-10-24: `zod`, `body-parser`, `@azure/msal-node`, `undici`, `fast-uri`), in the order CONTRIBUTING.md prescribes, with no `package.json` range change for `zod` and no changeset unless a published range moves.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Ticket scope | Fix whatever `pnpm run audit` reports on build's own checkout; note on the issue that `557b81c0` already fixed the four advisories the issue names | Claude for @Ygilany, grilling (2026-10-24), decision 1 | Two-way: revert the PR |
| 2. `@azure/msal-node` (high, patched only in 7.1.0) | Look for a newer `@azure/identity`, `mssql` or `tedious` that raises its own range; if none does, allowlist the scoped paths with a rationale row and a "remove when" note. No override to `^7.1.0` | Claude for @Ygilany, grilling, decision 2 | Two-way |
| 3. `undici`, `zod`, `fast-uri`, `body-parser` | Lockfile refresh first; a documented override only where the refresh doesn't reach, within `minimumReleaseAge` | Claude for @Ygilany, grilling, decision 3 | Two-way |
| 4. `zod` floor in `@askdb/core` | Stays `^4.6.5`; only the lockfile moves; no changeset | Claude for @Ygilany, grilling, decision 4 | Two-way |

```text
audit fails on advisory
   │
   ├─ patched version in range? ──yes──▶ refresh lockfile (zod, body-parser, undici, likely fast-uri)
   │
   ├─ parent pins vulnerable range? ──▶ bump parent ─or─ documented override (fast-uri if refresh misses)
   │                                     (msal-node: parent bump only, never override)
   │
   └─ no fix reachable, not exploitable here ──▶ path-scoped allowlist + CONTRIBUTING.md row (msal-node fallback)
```

**Risks:** the lockfile refresh moves many transitive packages at once (`ai`, `@ai-sdk/*`, astro), so a build, lint or test break can come from an unrelated bump. The advisory data moves daily, so build may see a different set than the one listed here.

**Done when:** `pnpm install --frozen-lockfile && pnpm run audit` exits 0; every fix follows the CONTRIBUTING.md order with an override comment or rationale row; `pnpm build`, `pnpm lint`, `pnpm test` pass; a changeset only if a published range moves.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

CI's `audit` job and step 2 of `pnpm preflight` run `pnpm run audit` (audit-ci over `pnpm audit`, failing at moderate or higher, dev dependencies included). It fails on `main`, so every branch's preflight and CI fail with it. The issue names four advisories (`proxy-addr`, `postcss-selector-parser`, `source-map-js`, `sprintf-js`); commit `557b81c0` (2026-10-06) already fixed those with overrides and a scoped allowlist. The audit now fails on a newer set: `zod` 4.6.5 (GHSA-mrhx-c7xc-m3w5, reaches published `@askdb/core`), `body-parser` 2.3.0 (example app only), `@azure/msal-node` 5.4.3 (GHSA-xcx6-jx8p-x3h5, under `mssql > tedious > @azure/identity` and docs-site), `undici` 7.30.0 (three advisories, under `@ai-sdk/provider-utils` and astro) and `fast-uri` 3.1.8 (under `ajv`, docs-site and dev only).

## Solution

Contributors and CI get a green audit again. The build stage installs the branch, runs the audit, and clears each reported advisory with the least lasting change that fixes it: a lockfile refresh where the patched version is already in range, a parent bump or a commented override where a parent pins a vulnerable range, and a path-scoped allowlist entry with a CONTRIBUTING.md rationale row only where no fix is reachable and the flaw is not exploitable in how AskDB uses the package. Published packages' `package.json` ranges stay as they are, so hosts see no change beyond what their own lockfiles pick up.

## User Stories

1. As a contributor, I want `pnpm preflight` to pass on a clean branch from `main`, so that a failure points at my change and not at stale advisories.
2. As a contributor, I want CI's `audit` job green on `main`, so that my PR's checks reflect my PR.
3. As the maintainer, I want each advisory fixed by a lockfile refresh when the patched version is in range, so that no override outlives its reason.
4. As the maintainer, I want every new override to carry a comment naming the advisory, where it reaches (dev or runtime) and when to drop it, so that a later cleanup knows when it is safe to remove.
5. As the maintainer, I want every new allowlist entry scoped to its dependency path and explained in the CONTRIBUTING.md table, so that the allowlist never hides the same advisory on a new path.
6. As the maintainer, I want `@azure/msal-node` not forced two majors up under `mssql`, so that `@askdb/sqlserver` doesn't ship on an untested Azure auth stack.
7. As the maintainer, I want the `@azure/msal-node` allowlist row, if needed, to say why the advisory doesn't apply (the auth_code flow) and when to remove it, so that it is dropped once `@azure/identity` moves to a patched range.
8. As a host app developer depending on `@askdb/core`, I want its `zod` range unchanged, so that I am not forced to upgrade `zod` by an AskDB release that only refreshed a lockfile.
9. As the issue's reader, I want a note that the four advisories the issue names were fixed by `557b81c0`, so that the ticket's history matches what this PR fixes.
10. As a later agent reading the PR, I want the PR body to list each advisory with how it was cleared (refresh, bump, override, allowlist), so that I can check the order was followed without re-running the audit.

## Implementation Decisions

- **Scope (decision 1).** Build runs `pnpm install --frozen-lockfile && pnpm run audit` on its own checkout and fixes the set it reports then, which may differ from the list above. It does not re-fix `proxy-addr`, `postcss-selector-parser` or `source-map-js`. It posts a comment on the issue saying `557b81c0` fixed the four named advisories and listing the set this PR fixes.
- **Lockfile refresh first (decision 3).** For each advisory whose patched version is inside the ranges that already resolve it (expected: `zod` 4.6.7, `body-parser` 2.4.0, `undici` 7.30.1, and `fast-uri` if `ajv`'s range admits 3.1.9), refresh with `pnpm update -r --no-save <pkg>...`, the CONTRIBUTING.md step 1 command. No override or allowlist entry for an advisory the refresh clears.
- **Overrides only where the refresh misses (decision 3).** Where a parent pins a vulnerable range, add an `overrides` entry in `pnpm-workspace.yaml` in the existing style: a comment naming the GHSA id and severity, the dev/runtime reach, the patched version, and when to drop it. The overridden version must clear `minimumReleaseAge`; build does not add `minimumReleaseAgeExclude` entries for this ticket.
- **`@azure/msal-node` (decision 2).** Build checks whether a released `@azure/identity`, `mssql` or `tedious` (within the release-age rule) depends on `@azure/msal-node` >= 7.1.0, and bumps that parent if one does. No override to `^7.1.0` in any case. If no parent exists, it adds one `.audit-ci.json` entry per path the audit reports (`GHSA-xcx6-jx8p-x3h5|<path>`), and one CONTRIBUTING.md row per group of paths, as the `sprintf-js` rows do. The row says the advisory is in MSAL's authorization-code (auth_code) flow, which AskDB's SQL Server connections don't use (tedious authenticates with password, service principal, managed identity, default credential or access token, none of which is auth_code), and that the docs-site path runs only in the static build; it says to remove the entries when `@azure/identity` depends on `@azure/msal-node` >= 7.1.0. If build finds AskDB reaches the auth_code flow, the allowlist is not available under CONTRIBUTING.md step 3, and build escalates instead.
- **`zod` floor (decision 4).** `packages/core/package.json` keeps `zod: ^4.6.5`; only `pnpm-lock.yaml` moves. No changeset.
- **Published ranges.** `mssql` is an optional peer `>=12` of `@askdb/sqlserver` and Studio, and a devDependency elsewhere, so a parent bump under decision 2 moves the lockfile and at most a devDependency range, which ships nothing. If a fix does change a published `dependencies` or peer range, build adds a changeset naming the security fix, as AGENTS.md requires; it never hard-pins one.
- **Files expected to change:** `pnpm-lock.yaml`; `pnpm-workspace.yaml` (only for an override); `.audit-ci.json` and the CONTRIBUTING.md "Dependency Audit" table (only for an allowlist entry). No source code.

## Testing Decisions

- The acceptance check is the audit itself: `pnpm install --frozen-lockfile && pnpm run audit` exits 0 on the branch. There is no unit seam for a lockfile change, and no new test file.
- `pnpm build`, `pnpm lint` and `pnpm test` must pass after the refresh, since the refresh moves runtime dependencies of published packages (`zod`, `undici` under `@ai-sdk/provider-utils`).
- When the `@azure/msal-node` handling changes what resolves under `mssql` (a parent bump), build runs the SQL Server integration tests against the multi-engine fixture (`pnpm fixture:up`, `ASKDB_FIXTURE_HOST`) where it is available, and says in the PR whether it ran them. An allowlist leaves the resolved tree unchanged, so no fixture run is needed for it.
- `pnpm smoke:install` and `pnpm preflight` run before the PR leaves draft, as AGENTS.md requires.

## Out of Scope

- Re-fixing `proxy-addr`, `postcss-selector-parser` or `source-map-js`, already fixed by `557b81c0`.
- Moving off `gray-matter`'s `js-yaml` 3 path to drop the `sprintf-js` allowlist.
- Changing audit-ci's severity threshold or the shape of `.audit-ci.json`.
- Upgrading AI SDK or `mssql` majors beyond what a security fix needs.
- Tidying rows or allowlist entries this ticket doesn't touch (for example audit-ci's "Consider not allowlisting paths" notice on `sprintf-js`).

## Further Notes

- Triage ran the audit on 2026-10-24 with pnpm 11.28.4; the advisory table in the triage comment is the starting point, not the contract.
- `minimumReleaseAge: 720` is in minutes (12 hours), so releases from 2026-10-13 onward, including `@azure/msal-node` 7.1.x, clear it by build time.
- GHSA-xcx6-jx8p-x3h5's own text: "This affects the auth_code flow"; workaround: pass only the auth_code to `acquireTokenByCode`.

## Ticket coverage

| Acceptance criterion (triage comment) | Met by |
| --- | --- |
| `pnpm run audit` exits 0 on a clean checkout of the branch, with the lockfile frozen. / `pnpm install --frozen-lockfile && pnpm run audit` exits 0. | Implementation Decisions: Scope; Testing Decisions: the acceptance check |
| Every advisory fixed by a patched version is fixed by a lockfile refresh, a parent bump, or a documented `overrides` entry, in the CONTRIBUTING.md order. | Implementation Decisions: Lockfile refresh first, Overrides only where the refresh misses, `@azure/msal-node` (decisions 2, 3) |
| No override or allowlist entry exists for an advisory that a lockfile refresh alone would have fixed. | Implementation Decisions: Lockfile refresh first (decision 3) |
| Every new `.audit-ci.json` allowlist entry is scoped to its path and has a CONTRIBUTING.md rationale row. / Each new override has a comment (advisory, reach, removal condition); each new allowlist entry has a rationale row. | Implementation Decisions: Overrides only where the refresh misses; `@azure/msal-node` (decision 2) |
| No `package.json` range for a published package is hard-pinned or raised without a changeset naming why. / A changeset is added only if a published package's range changes. | Implementation Decisions: `zod` floor (decision 4); Published ranges |
| `pnpm build`, `pnpm lint` and `pnpm test` still pass; SQL Server tests run when the msal-node handling touches the `mssql` path and the fixture is available. | Testing Decisions |
