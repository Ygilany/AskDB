#!/usr/bin/env node
// Validates every packed AskDB tarball in a directory:
//   - LICENSE, NOTICE, and README.md ship at the package root (Apache-2.0 §4 redistribution).
//   - Every path referenced by package.json "main", "module", "types"/"typings", "bin", and
//     "exports" (including conditional/nested entries) exists in the tarball.
//   - No tarball ships TypeScript sources (src/) or test files (*.test.*).
//
//   - With a workspace root, every non-private package under packages/* and apps/* was packed.
//
// Usage: node check-tarballs.mjs <tarball-dir> [workspace-root]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const workspaceRoot = process.argv[3];
if (!dir) {
  console.error("usage: check-tarballs.mjs <tarball-dir> [workspace-root]");
  process.exit(2);
}

const REQUIRED_FILES = ["LICENSE", "NOTICE", "README.md"];
const FORBIDDEN_ENTRY = /(^src\/|\.test\.)/;

/** Collect every string target from an "exports" value (string, array, or condition map). */
function collectExportTargets(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectExportTargets(item, out);
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) collectExportTargets(item, out);
  }
}

function normalize(target) {
  return path.posix.normalize(target.replace(/^\.\//, ""));
}

const tarballs = readdirSync(dir).filter((f) => f.endsWith(".tgz")).sort();
if (tarballs.length === 0) {
  console.error(`smoke: no tarballs found in ${dir}`);
  process.exit(1);
}

const failures = [];
for (const tarball of tarballs) {
  const file = path.join(dir, tarball);
  const entries = new Set(
    execFileSync("tar", ["-tzf", file], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, "")),
  );
  const pkg = JSON.parse(execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8" }));
  const problems = [];

  for (const required of REQUIRED_FILES) {
    if (!entries.has(required)) problems.push(`missing ${required}`);
  }
  for (const entry of entries) {
    if (FORBIDDEN_ENTRY.test(entry)) problems.push(`ships source/test file "${entry}"`);
  }

  const targets = [];
  for (const field of ["main", "module", "types", "typings"]) {
    if (typeof pkg[field] === "string") targets.push([field, pkg[field]]);
  }
  if (typeof pkg.bin === "string") {
    targets.push(["bin", pkg.bin]);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const [name, target] of Object.entries(pkg.bin)) targets.push([`bin.${name}`, target]);
  }
  const exportTargets = [];
  collectExportTargets(pkg.exports, exportTargets);
  for (const target of exportTargets) targets.push(["exports", target]);

  for (const [field, target] of targets) {
    const rel = normalize(target);
    if (rel.includes("*")) {
      // Subpath pattern: require at least one file matching the pattern.
      const [prefix, suffix] = rel.split("*", 2);
      const matched = [...entries].some((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
      if (!matched) problems.push(`${field} pattern "${target}" matches no files`);
    } else if (!entries.has(rel)) {
      problems.push(`${field} -> "${target}" not in tarball`);
    }
  }

  if (problems.length > 0) {
    failures.push(`${pkg.name} (${tarball}):\n    - ${problems.join("\n    - ")}`);
  } else {
    console.log(`smoke: ${pkg.name} tarball ok (${targets.length} entry paths, ${REQUIRED_FILES.join("/")})`);
  }
}

// When given the workspace root, also require that every publishable (non-private) workspace
// package under packages/* and apps/* was packed, so new packages can't skip these checks.
if (workspaceRoot) {
  const packed = new Set(
    tarballs.map(
      (tarball) =>
        JSON.parse(execFileSync("tar", ["-xzOf", path.join(dir, tarball), "package/package.json"], { encoding: "utf8" }))
          .name,
    ),
  );
  for (const group of ["packages", "apps"]) {
    for (const entry of readdirSync(path.join(workspaceRoot, group))) {
      const manifest = path.join(workspaceRoot, group, entry, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.private) continue;
      if (!packed.has(pkg.name)) failures.push(`${pkg.name} (${group}/${entry}): publishable but not packed by the smoke test`);
    }
  }
}

if (failures.length > 0) {
  console.error(`smoke: FAILED — tarball validation:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
