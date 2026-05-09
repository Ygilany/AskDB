#!/usr/bin/env bash
# Phase 4 Group 4 — installable smoke test for @askdb/core.
#
# Builds the workspace, packs each of the three published packages, copies the consumer fixture
# into a fresh tmpdir, installs @askdb/core from the local tarball (no `pg`, no workspace), runs
# `tsc --noEmit`, and executes the smoke script. Fails clearly if `private: true` slips back,
# `dist/` loses files, types break, or the executor seam regresses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK="$(mktemp -d -t askdb-smoke-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "smoke: workdir = $WORK"

echo "smoke: building workspace…"
pnpm -C "$ROOT" -r build >/dev/null

echo "smoke: packing tarballs…"
mkdir -p "$WORK/tarballs"
for pkg in core cli http-api; do
  (cd "$ROOT/packages/$pkg" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null)
done

CORE_TARBALL="$(ls "$WORK/tarballs"/askdb-core-*.tgz | head -n1)"
[ -f "$CORE_TARBALL" ] || { echo "smoke: missing core tarball" >&2; exit 1; }

echo "smoke: staging consumer fixture…"
cp -R "$SCRIPT_DIR/consumer" "$WORK/consumer"
# Wire the just-packed @askdb/core tarball into the consumer's package.json.
node -e "
  const fs = require('fs');
  const p = '$WORK/consumer/package.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.dependencies['@askdb/core'] = 'file:$CORE_TARBALL';
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

echo "smoke: npm install (no pg)…"
(cd "$WORK/consumer" && npm install --silent --no-audit --no-fund --no-package-lock)

# Sanity: confirm `pg` is NOT in the consumer's node_modules — the optional peer must stay opt-in.
if [ -d "$WORK/consumer/node_modules/pg" ]; then
  echo "smoke: FAILED — 'pg' was installed in the consumer; it must remain an optional peer." >&2
  exit 1
fi

echo "smoke: tsc --noEmit…"
(cd "$WORK/consumer" && npx --yes tsc --noEmit)

echo "smoke: tsx src/smoke.ts…"
(cd "$WORK/consumer" && npx --yes tsx src/smoke.ts)

echo "smoke: PASSED"
