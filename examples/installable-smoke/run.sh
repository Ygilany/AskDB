#!/usr/bin/env bash
# Installable smoke test for AskDB packages.
#
# Builds the workspace, packs the library packages (including config, enrich, ai, and tui) plus the app
# packages (cli, studio, http-api), copies the consumer fixture into a fresh tmpdir, installs
# library tarballs (no workspace; includes @askdb/config for @askdb/rag's dependency), runs `tsc --noEmit`,
# and executes the smoke script. The app sandbox gets a minimal askdb.config.ts because the CLI
# bootstraps runtime config on startup.
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
for pkg in packages/config packages/core packages/ai packages/ai-openai packages/ai-azure packages/ai-google packages/ai-anthropic packages/client packages/introspect packages/connectors packages/postgres packages/prisma packages/enrich packages/tui packages/mysql packages/sqlite packages/sqlserver apps/cli apps/studio apps/http-api; do
  (cd "$ROOT/$pkg" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null)
done
for pkg in packages/rag; do
  (cd "$ROOT/$pkg" && pnpm pack --pack-destination "$WORK/tarballs" >/dev/null)
done

CONFIG_TARBALL="$(ls "$WORK/tarballs"/askdb-config-*.tgz | head -n1)"
[ -f "$CONFIG_TARBALL" ] || { echo "smoke: missing config tarball" >&2; exit 1; }
CORE_TARBALL="$(ls "$WORK/tarballs"/askdb-core-*.tgz | head -n1)"
[ -f "$CORE_TARBALL" ] || { echo "smoke: missing core tarball" >&2; exit 1; }
AI_TARBALL="$(ls "$WORK/tarballs"/askdb-ai-*.tgz | grep -Ev 'askdb-ai-(openai|azure|google|anthropic)-' | head -n1)"
[ -f "$AI_TARBALL" ] || { echo "smoke: missing ai tarball" >&2; exit 1; }
AI_OPENAI_TARBALL="$(ls "$WORK/tarballs"/askdb-ai-openai-*.tgz | head -n1)"
[ -f "$AI_OPENAI_TARBALL" ] || { echo "smoke: missing ai-openai tarball" >&2; exit 1; }
AI_AZURE_TARBALL="$(ls "$WORK/tarballs"/askdb-ai-azure-*.tgz | head -n1)"
[ -f "$AI_AZURE_TARBALL" ] || { echo "smoke: missing ai-azure tarball" >&2; exit 1; }
AI_GOOGLE_TARBALL="$(ls "$WORK/tarballs"/askdb-ai-google-*.tgz | head -n1)"
[ -f "$AI_GOOGLE_TARBALL" ] || { echo "smoke: missing ai-google tarball" >&2; exit 1; }
AI_ANTHROPIC_TARBALL="$(ls "$WORK/tarballs"/askdb-ai-anthropic-*.tgz | head -n1)"
[ -f "$AI_ANTHROPIC_TARBALL" ] || { echo "smoke: missing ai-anthropic tarball" >&2; exit 1; }
CLIENT_TARBALL="$(ls "$WORK/tarballs"/askdb-client-*.tgz | head -n1)"
[ -f "$CLIENT_TARBALL" ] || { echo "smoke: missing client tarball" >&2; exit 1; }
INTROSPECT_TARBALL="$(ls "$WORK/tarballs"/askdb-introspect-*.tgz | head -n1)"
[ -f "$INTROSPECT_TARBALL" ] || { echo "smoke: missing introspect tarball" >&2; exit 1; }
CONNECTORS_TARBALL="$(ls "$WORK/tarballs"/askdb-connectors-*.tgz | head -n1)"
[ -f "$CONNECTORS_TARBALL" ] || { echo "smoke: missing connectors tarball" >&2; exit 1; }
POSTGRES_TARBALL="$(ls "$WORK/tarballs"/askdb-postgres-*.tgz | head -n1)"
[ -f "$POSTGRES_TARBALL" ] || { echo "smoke: missing postgres tarball" >&2; exit 1; }
PRISMA_TARBALL="$(ls "$WORK/tarballs"/askdb-prisma-*.tgz | head -n1)"
[ -f "$PRISMA_TARBALL" ] || { echo "smoke: missing prisma tarball" >&2; exit 1; }
ENRICH_TARBALL="$(ls "$WORK/tarballs"/askdb-enrich-*.tgz | head -n1)"
[ -f "$ENRICH_TARBALL" ] || { echo "smoke: missing enrich tarball" >&2; exit 1; }
CLI_TARBALL="$(ls "$WORK/tarballs"/askdb-[0-9]*.tgz | head -n1)"
[ -f "$CLI_TARBALL" ] || { echo "smoke: missing cli tarball" >&2; exit 1; }
STUDIO_TARBALL="$(ls "$WORK/tarballs"/askdb-studio-*.tgz | head -n1)"
[ -f "$STUDIO_TARBALL" ] || { echo "smoke: missing studio tarball" >&2; exit 1; }
TUI_TARBALL="$(ls "$WORK/tarballs"/askdb-tui-*.tgz | head -n1)"
[ -f "$TUI_TARBALL" ] || { echo "smoke: missing tui tarball" >&2; exit 1; }
RAG_TARBALL="$(ls "$WORK/tarballs"/askdb-rag-*.tgz | head -n1)"
[ -f "$RAG_TARBALL" ] || { echo "smoke: missing rag tarball" >&2; exit 1; }
MYSQL_TARBALL="$(ls "$WORK/tarballs"/askdb-mysql-*.tgz | head -n1)"
[ -f "$MYSQL_TARBALL" ] || { echo "smoke: missing mysql tarball" >&2; exit 1; }
SQLITE_TARBALL="$(ls "$WORK/tarballs"/askdb-sqlite-*.tgz | head -n1)"
[ -f "$SQLITE_TARBALL" ] || { echo "smoke: missing sqlite tarball" >&2; exit 1; }
SQLSERVER_TARBALL="$(ls "$WORK/tarballs"/askdb-sqlserver-*.tgz | head -n1)"
[ -f "$SQLSERVER_TARBALL" ] || { echo "smoke: missing sqlserver tarball" >&2; exit 1; }

echo "smoke: validating @askdb/config tarball contents…"
CONFIG_TARBALL_FILES="$(tar -tzf "$CONFIG_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$CONFIG_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$CONFIG_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$CONFIG_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$CONFIG_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/config tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/ai tarball contents…"
AI_TARBALL_FILES="$(tar -tzf "$AI_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$AI_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$AI_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$AI_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$AI_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/ai tarball includes source/tests" >&2
  exit 1
fi

for provider_package in \
  "@askdb/ai-openai:$AI_OPENAI_TARBALL" \
  "@askdb/ai-azure:$AI_AZURE_TARBALL" \
  "@askdb/ai-google:$AI_GOOGLE_TARBALL" \
  "@askdb/ai-anthropic:$AI_ANTHROPIC_TARBALL"; do
  provider_name="${provider_package%%:*}"
  provider_tarball="${provider_package#*:}"
  echo "smoke: validating $provider_name tarball contents…"
  provider_tarball_files="$(tar -tzf "$provider_tarball")"
  grep -q '^package/dist/index.js$' <<<"$provider_tarball_files"
  grep -q '^package/README.md$' <<<"$provider_tarball_files"
  grep -q '^package/LICENSE$' <<<"$provider_tarball_files"
  if grep -Eq '(^package/src/|\.test\.)' <<<"$provider_tarball_files"; then
    echo "smoke: FAILED — $provider_name tarball includes source/tests" >&2
    exit 1
  fi
done

echo "smoke: validating @askdb/client tarball contents…"
CLIENT_TARBALL_FILES="$(tar -tzf "$CLIENT_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$CLIENT_TARBALL_FILES"
grep -q '^package/dist/errors.js$' <<<"$CLIENT_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$CLIENT_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$CLIENT_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$CLIENT_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/client tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/connectors tarball contents…"
CONNECTORS_TARBALL_FILES="$(tar -tzf "$CONNECTORS_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$CONNECTORS_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$CONNECTORS_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$CONNECTORS_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$CONNECTORS_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/connectors tarball includes source/tests" >&2
  exit 1
fi

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

echo "smoke: validating @askdb/enrich tarball contents…"
ENRICH_TARBALL_FILES="$(tar -tzf "$ENRICH_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$ENRICH_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$ENRICH_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$ENRICH_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$ENRICH_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/enrich tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating askdb tarball contents…"
CLI_TARBALL_FILES="$(tar -tzf "$CLI_TARBALL")"
grep -q '^package/dist/cli.js$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/dist/introspect.js$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$CLI_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$CLI_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$CLI_TARBALL_FILES"; then
  echo "smoke: FAILED — askdb tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/studio tarball contents…"
STUDIO_TARBALL_FILES="$(tar -tzf "$STUDIO_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$STUDIO_TARBALL_FILES"
grep -q '^package/dist/bin.js$' <<<"$STUDIO_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$STUDIO_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$STUDIO_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$STUDIO_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/studio tarball includes source/tests" >&2
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

echo "smoke: validating @askdb/mysql tarball contents…"
MYSQL_TARBALL_FILES="$(tar -tzf "$MYSQL_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$MYSQL_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$MYSQL_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$MYSQL_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$MYSQL_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/mysql tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/sqlite tarball contents…"
SQLITE_TARBALL_FILES="$(tar -tzf "$SQLITE_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$SQLITE_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$SQLITE_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$SQLITE_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$SQLITE_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/sqlite tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: validating @askdb/sqlserver tarball contents…"
SQLSERVER_TARBALL_FILES="$(tar -tzf "$SQLSERVER_TARBALL")"
grep -q '^package/dist/index.js$' <<<"$SQLSERVER_TARBALL_FILES"
grep -q '^package/README.md$' <<<"$SQLSERVER_TARBALL_FILES"
grep -q '^package/LICENSE$' <<<"$SQLSERVER_TARBALL_FILES"
if grep -Eq '(^package/src/|\.test\.)' <<<"$SQLSERVER_TARBALL_FILES"; then
  echo "smoke: FAILED — @askdb/sqlserver tarball includes source/tests" >&2
  exit 1
fi

echo "smoke: staging consumer fixture…"
cp -R "$SCRIPT_DIR/consumer" "$WORK/consumer"
# Wire the just-packed AskDB tarballs into the consumer's package.json.
node -e "
  const fs = require('fs');
  const p = '$WORK/consumer/package.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.dependencies['@askdb/config'] = 'file:$CONFIG_TARBALL';
  j.dependencies['@askdb/core'] = 'file:$CORE_TARBALL';
  j.dependencies['@askdb/ai'] = 'file:$AI_TARBALL';
  j.dependencies['@askdb/ai-openai'] = 'file:$AI_OPENAI_TARBALL';
  j.dependencies['@askdb/client'] = 'file:$CLIENT_TARBALL';
  j.dependencies['@askdb/introspect'] = 'file:$INTROSPECT_TARBALL';
  j.dependencies['@askdb/connectors'] = 'file:$CONNECTORS_TARBALL';
  j.dependencies['@askdb/postgres'] = 'file:$POSTGRES_TARBALL';
  j.dependencies['@askdb/prisma'] = 'file:$PRISMA_TARBALL';
  j.dependencies['@askdb/enrich'] = 'file:$ENRICH_TARBALL';
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
      '@askdb/config': 'file:$CONFIG_TARBALL',
      '@askdb/core': 'file:$CORE_TARBALL',
      '@askdb/ai': 'file:$AI_TARBALL',
      '@askdb/ai-openai': 'file:$AI_OPENAI_TARBALL',
      '@askdb/ai-azure': 'file:$AI_AZURE_TARBALL',
      '@askdb/ai-google': 'file:$AI_GOOGLE_TARBALL',
      '@askdb/ai-anthropic': 'file:$AI_ANTHROPIC_TARBALL',
      '@askdb/client': 'file:$CLIENT_TARBALL',
      '@askdb/introspect': 'file:$INTROSPECT_TARBALL',
      '@askdb/connectors': 'file:$CONNECTORS_TARBALL',
      '@askdb/postgres': 'file:$POSTGRES_TARBALL',
      '@askdb/prisma': 'file:$PRISMA_TARBALL',
      '@askdb/enrich': 'file:$ENRICH_TARBALL',
      askdb: 'file:$CLI_TARBALL',
      '@askdb/studio': 'file:$STUDIO_TARBALL',
      '@askdb/tui': 'file:$TUI_TARBALL',
      '@askdb/rag': 'file:$RAG_TARBALL',
      '@askdb/mysql': 'file:$MYSQL_TARBALL',
      '@askdb/sqlite': 'file:$SQLITE_TARBALL',
      '@askdb/sqlserver': 'file:$SQLSERVER_TARBALL'
    }
  };
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"

echo "smoke: npm install app sandbox…"
(cd "$WORK/apps" && npm install --silent --no-audit --no-fund --no-package-lock)

echo "smoke: minimal askdb.config.ts for cli bootstrap…"
cat >"$WORK/apps/askdb.config.ts" <<'SMOKEASKDB'
import dotenv from "dotenv";
import { defineConfig, type AskDbConfig } from "@askdb/config";

dotenv.config({ quiet: true });

/** Minimal valid config so installable-smoke can run `askdb` (bootstrap requires askdb.config.*). */
export default defineConfig({
  ai: {
    provider: "openai",
    providerConfig: {
      openai: { apiKey: "", model: "gpt-4o-mini" },
    },
  },
  database: {
    provider: "postgres",
    providerConfig: {
      postgres: { databaseUrl: "postgres://127.0.0.1:65432/askdb_smoke_placeholder" },
    },
  },
  introspection: {
    provider: "postgres",
    providerConfig: { postgres: {} },
    outputDir: "./.askdb-smoke-introspect",
  },
  rag: {
    embedder: "mock",
    embedderConfig: {},
    store: "memory",
    storeConfig: { memory: {} },
  },
} satisfies AskDbConfig);
SMOKEASKDB

echo "smoke: askdb cli bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb --help | grep -q 'AskDB')
(cd "$WORK/apps" && ./node_modules/.bin/askdb introspect templates --engine postgres | grep -q '^-- schemas')

echo "smoke: askdb-tui bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb-tui --version >/dev/null)

echo "smoke: askdb-studio bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb-studio --version >/dev/null)
(cd "$WORK/apps" && ./node_modules/.bin/askdb studio --help | grep -q 'askdb-studio')

echo "smoke: askdb-rag bin…"
(cd "$WORK/apps" && ./node_modules/.bin/askdb-rag --version >/dev/null)
echo "smoke: PASSED"
