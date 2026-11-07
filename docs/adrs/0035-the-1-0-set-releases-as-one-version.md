# ADR 0035 — The 1.0 set releases as one version

## Status

Accepted (2026-11-06, maintainer decision in #354's first round: Q1–Q3 by the maintainer, Q4 by the coordinator). Implemented in `.changeset/config.json`, `scripts/prerelease-counter.mjs` and `docs/release.md`.

## Context

[ADR 0030](0030-1-0-promises-checked-sql-only.md) chose the packages that go to 1.0: `askdb`, `@askdb/ai`, `@askdb/client`, `@askdb/config`, `@askdb/core`, `@askdb/http-api`, `@askdb/introspect`, `@askdb/mysql`, `@askdb/postgres`, `@askdb/prisma`, `@askdb/sqlite` and `@askdb/sqlserver`. It didn't say how their versions move. Before the release candidates:

- **Versions were scattered.** Five packages were on `1.0.0-beta.N` (core, `askdb` and http-api at beta.46; client at beta.9; config at beta.15), and seven were on `0.x` betas. Only core, `askdb` and http-api were `linked`.
- **Betas published under `latest`.** The `beta` dist-tag was stale and was removed (#267). Trusted publishing sets one dist-tag per publish and can't move another tag afterwards without an npm token.
- **Changesets 3 doesn't restart the prerelease counter when the pre tag changes.** `getPreVersion` in `@changesets/assemble-release-plan` is the current version's prerelease number plus one, whatever its tag. A dry run of `pre exit`, `pre enter rc` and `changeset version` gave `1.0.0-rc.47` for core and `0.2.0-rc.40` for Studio. A `fixed` group takes the highest number in the group.
- **At the stable release, every file in `.changeset/pre/` goes into the stable CHANGELOG entry.** On `main` that was 289 beta changesets, which added 458 lines to core's `1.0.0` entry in a dry run.

## Options considered

### Lockstep

- **A. A `fixed` group of the 12 (chosen).** Every release publishes all 12 at one version, even a package that didn't change. One number names a set that works together, and each upgrade-guide section has one version. The cost: an unchanged engine package republishes with each release, and after 1.0.0 a major in any of the 12 moves all 12.
- **B. A `linked` group of the 12.** The packages that change share the next number, and unchanged ones keep older numbers. Fewer republishes, but a host can't tell from the numbers which versions go together.
- **C. Separate versions.** The beta-era scheme. Rejected for the same reason as B, more so.

### First release-candidate number

- **A. `1.0.0-rc.1` (chosen),** matching the milestone's name. `pnpm version-packages` runs `scripts/prerelease-counter.mjs reset` before `changeset version`: each public package whose prerelease id isn't the pre tag gets its counter set to 0, so the new line starts at `<tag>.1`. `check` runs after `changeset version` and fails if a public package still has another prerelease id, because that reset version isn't on npm and the release would publish it.
- **B. `1.0.0-rc.0`,** the same script resetting to `-beta` instead.
- **C. No reset:** the first release candidate is `1.0.0-rc.47`, and Studio is `0.2.0-rc.40`. No code, but the numbers suggest 46 earlier candidates.

Setting the versions by hand in the PR that enters `rc` was rejected for every option: `main` would then hold versions npm doesn't have, and `release.yml` publishes any such version.

### Dist-tag for the release candidates

- **A. `latest` (chosen),** as for the betas. `npm install askdb` gets the newest release candidate, the published consumer-lab run keeps testing `latest`, and the docs' `@latest` commands keep working. No stable version exists yet for `latest` to protect.
- **B. `rc`.** `npm install askdb` would stay on the last beta, and the workflow, the lab target and every install command would change.

### What the `1.0.0` CHANGELOG entry lists

- **A. Only the release candidates' changes (chosen).** The PR that enters `rc` deletes the beta-phase files in `.changeset/pre/`. Each beta's entries stay under its own version in every CHANGELOG.
- **B. Every change since the first beta.** The `1.0.0` entry repeats 289 entries that are already listed under their betas.

## Decision

- The 12 packages of the 1.0 set are one `fixed` group in `.changeset/config.json`. `linked` is empty. `@askdb/studio`, `@askdb/enrich` and `@askdb/rag` stay outside the group, on `0.x`.
- The release candidates start at `1.0.0-rc.1` (`0.2.0-rc.1` for the three `0.x` packages), through `scripts/prerelease-counter.mjs` in `pnpm version-packages`.
- The release candidates publish under `latest`. The PR that releases 1.0.0 changes both publish paths, `release.yml` and the root `release` script (`pnpm release`, the hand publish in `docs/release.md`), to publish a prerelease under its pre tag and a stable version under `latest`.
- The `1.0.0` CHANGELOG entry lists only the release candidates' changes.

## Consequences

- A breaking change to one of the 12 is a `major` changeset, unless it is confined to an experimental surface in ADR 0030, which takes a `minor` naming `askdb` or `@askdb/config`. After 1.0.0, a major in any of the 12 moves all 12.
- `1.0.0-rc.1` freezes the public API (ADRs 0030 and 0031), so a breaking change before 1.0.0 needs the maintainer's decision. The tooling doesn't enforce the freeze: in pre mode a `major` only raises the `rc` number.
- A breaking change to Studio, `@askdb/enrich` or `@askdb/rag` is a `minor`. A `major` would move that package to 1.0, which amends ADR 0030.
- Pre mode applies to every package, so the three `0.x` packages publish as `0.2.0-rc.N` during the release candidates and become stable `0.2.0` at 1.0.0.
- `pnpm changeset status` shows the counter before the reset (`1.0.0-rc.47`) right after a pre-tag change. The Version PR shows the real versions.
- Adding a package to the 1.0 set adds it to the `fixed` group and amends ADR 0030. A new public package outside the set stays out of the group.
