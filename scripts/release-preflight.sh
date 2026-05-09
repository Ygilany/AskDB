#!/usr/bin/env bash
# Local release preflight — what CI runs in `ci.yml`, but as one command.
#
# Use this before merging the changesets "Version Packages" PR (or before a
# manual `pnpm release`) to catch packaging / smoke / dry-publish regressions
# without pushing first.
#
# CI breaks the same checks into discrete named steps so the GitHub Actions UI
# shows per-step duration + pass/fail. Source of truth is mirrored: any step
# added here should be added to `.github/workflows/ci.yml` and vice versa.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() {
  echo
  echo "═══ $1 ═══"
}

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

step "build"
pnpm -r build

step "test"
pnpm test

step "installable smoke test"
pnpm smoke:install

step "validate publish (dry-run)"
pnpm -r publish --dry-run --no-git-checks --access=public

step "changeset status"
pnpm changeset status

echo
echo "preflight: OK"
