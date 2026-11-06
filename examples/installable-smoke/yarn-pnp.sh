#!/usr/bin/env bash
# Yarn 4 Plug'n'Play smoke (#748): the packed CLI and HTTP API load and exit 0 under strict
# peer resolution.
#
# Usage: yarn-pnp.sh <tarball-dir> <work-dir>
#
# Plug'n'Play gives a package its peer only through the package that depends on it. So an
# AskDB package that depends on `ai` or an `@ai-sdk/*` package must provide their `zod` peer,
# and one that depends on `@askdb/core` must declare core's `ai` peer to pass it through.
# npm and pnpm hoist and hide a gap; Plug'n'Play stops the process when the module loads.
#
# Two checks:
# 1. Every packed manifest follows those two rules, including packages the commands below
#    never load (`@askdb/prisma` is an optional peer of the CLI, so it isn't installed here).
# 2. A Yarn project that depends on `askdb` and `@askdb/http-api` alone, as `yarn dlx askdb`
#    does, runs their commands. `pnpFallbackMode: none` turns off the fallback to the
#    project's own dependencies, so no top-level package can cover a missing peer.
set -euo pipefail

TARBALLS="$(cd "$1" && pwd)"
mkdir -p "$2"
DIR="$(cd "$2" && pwd)"
# Yarn runs from a pinned release, not Corepack: Node 25+ no longer ships Corepack.
YARN_RELEASE="4.18.1"

mkdir -p "$DIR/project" "$DIR/yarn-cli"
npm install --silent --no-audit --no-fund --no-package-lock --prefix "$DIR/yarn-cli" "@yarnpkg/cli-dist@$YARN_RELEASE"
YARN_JS="$DIR/yarn-cli/node_modules/@yarnpkg/cli-dist/bin/yarn.js"
# Yarn's global cache lives in the work dir, so each run's tarballs don't pile up in
# ~/.yarn/berry/cache: every run packs them under a new temporary path.
yarn() { (cd "$DIR/project" && YARN_GLOBAL_FOLDER="$DIR/yarn-global" node "$YARN_JS" "$@"); }

# Every AskDB package resolves to its tarball, through `resolutions`, so nothing comes from npm.
echo "yarn-pnp: every packed package passes ai and zod through…"
node --input-type=module -e "
  import { readdirSync, writeFileSync } from 'node:fs';
  import { execFileSync } from 'node:child_process';
  const [dir, out, yarnRelease] = process.argv.slice(1);
  const resolutions = {};
  const manifests = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tgz'))) {
    const pkg = JSON.parse(execFileSync('tar', ['-xOzf', dir + '/' + file, 'package/package.json'], { encoding: 'utf8' }));
    resolutions[pkg.name] = 'file:' + dir + '/' + file;
    manifests[pkg.name] = pkg;
  }
  for (const name of ['askdb', '@askdb/http-api']) {
    if (!resolutions[name]) throw new Error('yarn-pnp: no tarball for ' + name);
  }
  const declares = (pkg, name) => Boolean(pkg.dependencies?.[name] ?? pkg.peerDependencies?.[name]);
  const gaps = [];
  for (const pkg of Object.values(manifests)) {
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const dep of deps.filter((d) => manifests[d]?.peerDependencies?.ai)) {
      if (!declares(pkg, 'ai')) gaps.push(pkg.name + ' depends on ' + dep + ', which peers ai, but declares no ai');
    }
    const sdk = deps.find((d) => d === 'ai' || d.startsWith('@ai-sdk/'));
    if (sdk && !declares(pkg, 'zod')) gaps.push(pkg.name + ' depends on ' + sdk + ', which peers zod, but declares no zod');
  }
  if (gaps.length) {
    console.error('yarn-pnp: FAILED — Plug\'n\'Play would leave these peers unreachable (#748):');
    for (const gap of gaps) console.error('  ' + gap);
    process.exit(1);
  }
  const manifest = {
    name: 'askdb-smoke-yarn-pnp',
    private: true,
    packageManager: 'yarn@' + yarnRelease,
    dependencies: { askdb: resolutions.askdb, '@askdb/http-api': resolutions['@askdb/http-api'] },
    resolutions,
  };
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
" "$TARBALLS" "$DIR/project/package.json" "$YARN_RELEASE"

# The project has no lockfile to check, so the install writes one. On CI, Yarn turns on
# immutable installs (and hardened mode on public pull requests), which refuse that write
# (YN0028); both are off here. npmMinimalAgeGate: 0 matches the npm installs in run.sh,
# which have no release-age gate. With Yarn's gate, a third-party release from the last day
# fails resolution when a range allows nothing older (an exact pin).
cat >"$DIR/project/.yarnrc.yml" <<'YARNRC'
nodeLinker: pnp
pnpFallbackMode: none
enableImmutableInstalls: false
enableHardenedMode: false
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
