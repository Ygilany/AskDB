# Release Checklist

Use this checklist before making AskDB packages public or publishing a new public version.

## Local Verification

```bash
pnpm install --frozen-lockfile
pnpm build
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

## npm Scope and Token

Before the first public publish:

- Confirm the npm `@askdb` scope exists and the maintainer account has publish rights.
- Confirm GitHub Actions secret `NPM_TOKEN` can publish public packages under `@askdb`.
- Confirm npm provenance is expected for the release workflow (`NPM_CONFIG_PROVENANCE=true`).
- Spot-check current registry state:

```bash
npm view @askdb/core version
```

An `E404` is expected before the first public publish.

## Publish Flow

1. Merge feature PRs with changesets.
2. Run `pnpm changeset version` on `main` or use the Changesets version PR flow.
3. Review generated package versions and changelogs.
4. Run `pnpm preflight`.
5. Trigger `.github/workflows/release.yml` on `main`.
6. After publish, check package pages and install one package from npm in a clean directory.

## Public Safety Note

AskDB returns generated SQL for review. It does not execute generated SQL in the current public surfaces. Any downstream execution must happen under the integrator's database roles, read-only controls, tenant policy, approval process, and audit logging.
