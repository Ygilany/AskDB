#!/usr/bin/env bash
# Installable smoke test for AskDB packages.
#
# Builds the workspace, packs the library packages plus the app packages
# (cli, http-api, tui), copies the consumer fixture into a fresh tmpdir, installs
# library tarballs (no workspace), runs `tsc --noEmit`, and executes the smoke script.
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
for pkg in packages/core packages/introspect packages/postgres packages/prisma apps/cli apps/http-api apps/tui; do
  (cd "$ROOT/$pkg" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null)
done
for pkg in packages/rag; do
  (cd "$ROOT/$pkg" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null)
done

CORE_TARBALL="$(ls "$WORK/tarballs"/askdb-core-*.tgz | head -n1)"
[ -f "$CORE_TARBALL" ] || { echo "smoke: missing core tarball" >&2; exit 1; }
INTROSPECT_TARBALL="$(ls "$WORK/tarballs"/askdb-introspect-*.tgz | head -n1)"
[ -f "$INTROSPECT_TARBALL" ] || { echo "smoke: missing introspect tarball" >&2; exit 1; }
POSTGRES_TARBALL="$(ls "$WORK/tarballs"/askdb-postgres-*.tgz | head -n1)"
[ -f "$POSTGRES_TARBALL" ] || { echo "smoke: missing postgres tarball" >&2; exit 1; }
PRISMA_TARBALL="$(ls "$WORK/tarballs"/askdb-prisma-*.tgz | head -n1)"
[ -f "$PRISMA_TARBALL" ] || { echo "smoke: missing prisma tarball" >&2; exit 1; }
CLI_TARBALL="$(ls "$WORK/tarballs"/askdb-cli-*.tgz | head -n1)"
[ -f "$CLI_TARBALL" ] || { echo "smoke: missing cli tarball" >&2; exit 1; }
TUI_TARBALL="$(ls "$WORK/tarballs"/askdb-tui-*.tgz | head -n1)"
[ -f "$TUI_TARBALL" ] || { echo "smoke: missing tui tarball" >&2; exit 1; }
RAG_TARBALL="$(ls "$WORK/tarballs"/askdb-rag-*.tgz | head -n1)"
[ -f "$RAG_TARBALL" ] || { echo "smoke: missing rag tarball" >&2; exit 1; }

echo "smoke: validating @askdb/introspect tarball contents…"
INTROSPECT_TARBALL_FILES="$(tar -tzf "$INTROSPECT_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$INTROSPECT_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$INTROSPECT_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$INTROSPECT_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$INTROSPECT_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/introspect tarball includes source/tests" >&2
  exit 1
fi
if grep -Eq '^package/dist/bin\.js$' <<<"$INTROSPECT_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/introspect should no longer ship a standalone bin" >&2
  exit 1
fi

echo "smoke: validating @askdb/postgres tarball contents…"
POSTGRES_TARBALL_FILES="$(tar -tzf "$POSTGRES_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$POSTGRES_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$POSTGRES_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$POSTGRES_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$POSTGRES_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/postgres tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/prisma tarball contents…"
PRISMA_TARBALL_FILES="$(tar -tzf "$PRISMA_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$PRISMA_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$PRISMA_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$PRISMA_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$PRISMA_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/prisma tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/cli tarball contents…"
CLI_TARBALL_FILES="$(tar -tzf "$CLI_TARBALL")"
grep -q '^package/dist/cli.js$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/dist/introspect.js$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$CLI_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$CLI_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/cli tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/tui tarball contents…"
TUI_TARBALL_FILES="$(tar -tzf "$TUI_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$TUI_TARBALL_FILES"
grep -q '^package/dist/bin.js$' <<<"$TUI_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$TUI_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$TUI_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$TUI_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/tui tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/rag tarball contents…"
RAG_TARBALL_FILES="$(tar -tzf "$RAG_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$RAG_TARBALL_FILES"
grep -q '^package/dist/bin.js$' <<<"$RAG_TARBALL_FILES"
grep -q '^package/dist/stores/memory.js$' <<<"$RAG_TARBALL_FILES"
grep -q '^package/dist/embedders/openai.js$' <<<"$RAG_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$RAG_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$RAG_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$RAG_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/rag tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: staging consumer fixture…"
cp -R "$SCRIPT_DIR/consumer" "$WORK/consumer"
# Wire the just-packed AskDB tarballs into the consumer's package.json.
node -e "
  const fs = require('fs');
  const p = '$WORK/consumer/package.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.dependencies['@askdb/core'] = 'file:$CORE_TARBALL';
  j.dependencies['@askdb/introspect'] = 'file:$INTROSPECT_TARBALL';
  j.dependencies['@askdb/postgres'] = 'file:$POSTGRES_TARBALL';
  j.dependencies['@askdb/prisma'] = 'file:$PRISMA_TARBALL';
  j.dependencies['@askdb/rag'] = 'file:$RAG_TARBALL';
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

echo "smoke: staging app sandbox…"
mkdir -p "$WORK/apps"
node -e "
  const fs = require('fs');
  const p = '$WORK/apps/package.json';
  const j = {
    name: 'askdb-app-smoke',
    private: true,
    type: 'module',
    dependencies: {
      '@askdb/core': 'file:$CORE_TARBALL',
      '@askdb/introspect': 'file:$INTROSPECT_TARBALL',
      '@askdb/postgres': 'file:$POSTGRES_TARBALL',
      '@askdb/prisma': 'file:$PRISMA_TARBALL',
      '@askdb/cli': 'file:$CLI_TARBALL',
      '@askdb/tui': 'file:$TUI_TARBALL',
      '@askdb/rag': 'file:$RAG_TARBALL'
    }
  };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

echo "smoke: npm install app sandbox…"
(cd "$WORK/apps" && npm install --silent --no-audit --no-fund --no-package-lock)

echo "smoke: askdb cli bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb --help | grep -q 'AskDB')
(cd "$WORK/apps" && ./node_modules/.bin/askdb introspect templates --engine postgres | grep -q '^-- schemas')

echo "smoke: askdb-tui bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb-tui --version >/dev/null)

echo "smoke: askdb-rag bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb-rag --version >/dev/null)
echo "smoke: PASSED"
