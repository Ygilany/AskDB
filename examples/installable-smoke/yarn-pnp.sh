#!/usr/bin/env bash
# Yarn 4 Plug'n'Play smoke (#748): the packed CLI and HTTP API start under strict peer resolution.
#
# Usage: yarn-pnp.sh <tarball-dir> <work-dir>
#
# Plug'n'Play gives a package its peer only through the package that depends on it. So an
# AskDB package that depends on `ai` or an `@ai-sdk/*` package must provide their `zod` peer,
# and one that depends on `@askdb/core` must declare core's `ai` peer to pass it through.
# npm and pnpm hoist and hide a gap; Plug'n'Play stops the process when the module loads.
# The project depends on `askdb` and `@askdb/http-api` alone, as `yarn dlx askdb` does, and
# `pnpFallbackMode: none` turns off the fallback to the project's own dependencies, so no
# top-level package can cover a missing peer.
set -euo pipefail

TARBALLS="$(cd "$1" && pwd)"
DIR="$2"
# Yarn runs from a pinned release, not Corepack: Node 25+ no longer ships Corepack.
YARN_RELEASE="4.18.1"

mkdir -p "$DIR/project" "$DIR/yarn-cli"
npm install --silent --no-audit --no-fund --no-package-lock --prefix "$DIR/yarn-cli" "@yarnpkg/cli-dist@$YARN_RELEASE"
YARN_JS="$DIR/yarn-cli/node_modules/@yarnpkg/cli-dist/bin/yarn.js"
yarn() { (cd "$DIR/project" && node "$YARN_JS" "$@"); }

# Every AskDB package resolves to its tarball, through `resolutions`, so nothing comes from npm.
node --input-type=module -e "
  import { readdirSync, writeFileSync } from 'node:fs';
  import { execFileSync } from 'node:child_process';
  const dir = process.argv[1];
  const resolutions = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tgz'))) {
    const pkg = JSON.parse(execFileSync('tar', ['-xOzf', dir + '/' + file, 'package/package.json'], { encoding: 'utf8' }));
    resolutions[pkg.name] = 'file:' + dir + '/' + file;
  }
  for (const name of ['askdb', '@askdb/http-api']) {
    if (!resolutions[name]) throw new Error('yarn-pnp: no tarball for ' + name);
  }
  const manifest = {
    name: 'askdb-smoke-yarn-pnp',
    private: true,
    packageManager: 'yarn@$YARN_RELEASE',
    dependencies: { askdb: resolutions.askdb, '@askdb/http-api': resolutions['@askdb/http-api'] },
    resolutions,
  };
  writeFileSync('$DIR/project/package.json', JSON.stringify(manifest, null, 2) + '\n');
" "$TARBALLS"

# npmMinimalAgeGate: 0 matches the npm installs in run.sh, which have no release-age gate. With
# Yarn's gate, a third-party release from the last day fails resolution when a range allows
# nothing older (an exact pin).
cat >"$DIR/project/.yarnrc.yml" <<'YARNRC'
nodeLinker: pnp
pnpFallbackMode: none
npmMinimalAgeGate: 0
enableTelemetry: false
YARNRC
touch "$DIR/project/yarn.lock"

echo "yarn-pnp: yarn install…"
if ! INSTALL_LOG="$(yarn install --mode=skip-build 2>&1)"; then
  echo "$INSTALL_LOG" >&2
  echo "yarn-pnp: FAILED — yarn install" >&2
  exit 1
fi

# A missing peer surfaces as "tried to access <peer> (a peer dependency) but it isn't provided
# by its ancestors" when the importing module loads. expect <pattern> <command…> runs the
# command through Yarn and fails unless it exits 0 and prints the pattern.
expect() {
  local pattern="$1" out
  shift
  if ! out="$(yarn "$@" 2>&1)" || ! grep -q -- "$pattern" <<<"$out"; then
    echo "$out" >&2
    echo "yarn-pnp: FAILED — yarn $* (expected exit 0 and output matching: $pattern)" >&2
    exit 1
  fi
}

# askdb loads every engine package at startup, so --version alone failed on askdb@1.0.0-beta.47.
echo "yarn-pnp: askdb --version, --help, introspect, studio and rag…"
expect '^[0-9]' askdb --version
expect 'AskDB' askdb --help
expect '^-- schemas' askdb introspect templates --engine postgres
expect 'askdb-studio' askdb studio --help
expect 'askdb rag' askdb rag --help

echo "yarn-pnp: askdb-http --help…"
expect 'askdb-http' askdb-http --help

echo "yarn-pnp: OK"
