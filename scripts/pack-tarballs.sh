#!/usr/bin/env bash
# Build and pack every publishable AskDB package into tarballs, the way `pnpm publish`
# would ship them (workspace: specifiers rewritten, `files` applied).
#
# Publishable = every packages/* and apps/* package whose package.json is not
# `"private": true`. Discovered, not listed, so a new package can't be packed-and-ignored.
#
# Usage: scripts/pack-tarballs.sh <dest-dir> [--root <checkout>] [--no-build]
#
#   <dest-dir>   emptied, then filled with one .tgz per package and a manifest.json:
#                [{ "name": "@askdb/core", "version": "1.0.0-beta.42", "file": "askdb-core-1.0.0-beta.42.tgz" }, …]
#   --root       the checkout to pack (default: this script's repo)
#   --no-build   skip `pnpm build` (the caller already built)
#
# Used by examples/installable-smoke/run.sh and the consumer lab (`pnpm lab:use`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST=""
BUILD=1
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$(cd "$2" && pwd)"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    -*) echo "pack-tarballs: unknown flag $1" >&2; exit 2 ;;
    *) DEST="$1"; shift ;;
  esac
done
[ -n "$DEST" ] || { echo "usage: scripts/pack-tarballs.sh <dest-dir> [--root <checkout>] [--no-build]" >&2; exit 2; }

rm -rf "$DEST"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

if [ "$BUILD" = 1 ]; then
  echo "pack-tarballs: building ${ROOT}…" >&2
  pnpm -C "$ROOT" build >/dev/null
fi

PACKAGES="$(node -e '
  const { readdirSync, readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const root = process.argv[1];
  const out = [];
  for (const group of ["packages", "apps"]) {
    for (const dir of readdirSync(join(root, group)).sort()) {
      const manifest = join(root, group, dir, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.private !== true) out.push(join(group, dir));
    }
  }
  console.log(out.join("\n"));
' "$ROOT")"

echo "pack-tarballs: packing $(wc -l <<<"$PACKAGES" | tr -d ' ') packages into ${DEST}…" >&2
for pkg in $PACKAGES; do
  (cd "$ROOT/$pkg" && pnpm pack --pack-destination "$DEST" >/dev/null)
done

node -e '
  const { readdirSync, writeFileSync } = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const { join } = require("node:path");
  const dest = process.argv[1];
  const manifest = readdirSync(dest)
    .filter((f) => f.endsWith(".tgz"))
    .sort()
    .map((file) => {
      const pkg = JSON.parse(execFileSync("tar", ["-xzOf", join(dest, file), "package/package.json"], { encoding: "utf8" }));
      return { name: pkg.name, version: pkg.version, file };
    });
  writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.error(`pack-tarballs: ${manifest.length} tarballs`);
' "$DEST"
