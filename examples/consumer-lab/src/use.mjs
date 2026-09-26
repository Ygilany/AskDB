#!/usr/bin/env node
/**
 * `pnpm lab:use <target>`: choose which AskDB the lab installs, then install it the way
 * an outside project would.
 *
 *   pnpm lab:use .              tarballs packed from this checkout
 *   pnpm lab:use <path>         tarballs packed from another checkout
 *   pnpm lab:use --if-needed .  install only when the lab has never been installed (used by lab:up)
 *   pnpm lab:use --restore      put package.json, pnpm-workspace.yaml and the lockfile back
 *
 * Every @askdb/* package, including transitive dependencies of the lab's direct ones,
 * is pinned to the target through pnpm overrides, then verified from the lockfile: the
 * command fails if any of them resolved from anywhere else.
 *
 * Dependency-free on purpose: it runs before anything is installed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(LAB, "../..");
const STATE = join(LAB, ".lab");
const TARBALLS = join(STATE, "tarballs");
const TARGET_FILE = join(STATE, "target.json");

/** The AskDB packages the lab imports or runs directly. Everything else arrives transitively. */
const DIRECT = ["@askdb/core", "@askdb/client", "@askdb/config", "askdb"];

const MANAGED = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
const BLOCK_BEGIN = "# lab:use overrides begin";
const BLOCK_END = "# lab:use overrides end";

function fail(message) {
  console.error(`lab:use: ${message}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function restore() {
  run("git", ["-C", LAB, "checkout", "--", ...MANAGED]);
  rmSync(STATE, { recursive: true, force: true });
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: LAB });
  console.log("lab:use: restored the committed baseline.");
}

/** Pack a checkout with this repo's pack script (older checkouts may not have one). */
function packCheckout(root) {
  if (!existsSync(join(root, "pnpm-workspace.yaml"))) fail(`${root} is not an AskDB checkout`);
  run("bash", [join(REPO, "scripts", "pack-tarballs.sh"), TARBALLS, "--root", root]);
  return JSON.parse(readFileSync(join(TARBALLS, "manifest.json"), "utf8"));
}

function describeCheckout(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const dirty = git("status", "--porcelain").length > 0;
  return `${git("rev-parse", "--short", "HEAD")}${dirty ? "+dirty" : ""} (${git("rev-parse", "--abbrev-ref", "HEAD")})`;
}

function pinTo(manifest) {
  const spec = (name) => {
    const entry = manifest.find((p) => p.name === name);
    if (!entry) fail(`the target has no ${name} package`);
    return `file:${relative(LAB, join(TARBALLS, entry.file))}`;
  };

  const pkgPath = join(LAB, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies = { ...pkg.dependencies };
  for (const name of DIRECT) pkg.dependencies[name] = spec(name);
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const wsPath = join(LAB, "pnpm-workspace.yaml");
  const ws = readFileSync(wsPath, "utf8");
  const begin = ws.indexOf(BLOCK_BEGIN);
  const end = ws.indexOf(BLOCK_END);
  if (begin < 0 || end < begin) fail("pnpm-workspace.yaml has lost its lab:use overrides block");
  const lines = ["overrides:", ...manifest.map((p) => `  "${p.name}": "${spec(p.name)}"`)];
  writeFileSync(wsPath, `${ws.slice(0, begin + BLOCK_BEGIN.length)}\n${lines.join("\n")}\n${ws.slice(end)}`);
}

/**
 * Every @askdb/* (and `askdb`) package in the lockfile, with where it resolved from.
 * pnpm lockfile v9 keys packages as `name@<version-or-spec>`; a tarball install keys
 * them as `name@file:<path>`.
 */
function resolvedAskDbPackages() {
  const lock = readFileSync(join(LAB, "pnpm-lock.yaml"), "utf8");
  const section = lock.slice(lock.indexOf("\npackages:\n"), lock.indexOf("\nsnapshots:\n"));
  const found = new Map();
  for (const match of section.matchAll(/^ {2}'?((?:@askdb\/[\w.-]+)|askdb)@([^':\n]+(?::[^':\n]+)?)'?:\n((?: {4}.*\n)*)/gm)) {
    const [, name, spec, body] = match;
    const version = /^ {4}version: (\S+)/m.exec(body)?.[1] ?? spec;
    found.set(`${name}@${spec}`, { name, spec, version, fromTarball: spec.startsWith("file:") });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function verify(manifest) {
  const resolved = resolvedAskDbPackages();
  const expected = new Map(manifest.map((p) => [p.name, p.version]));
  const rows = resolved.map((r) => {
    const ok = r.fromTarball && expected.get(r.name) === r.version;
    return { ok, package: r.name, version: r.version, source: r.fromTarball ? "tarball" : `registry (${r.spec})` };
  });
  const width = Math.max(...rows.map((r) => r.package.length), 7);
  console.log(`\n${"package".padEnd(width)}  version              source`);
  for (const r of rows) console.log(`${r.package.padEnd(width)}  ${r.version.padEnd(20)} ${r.source}${r.ok ? "" : "   <-- NOT THE TARGET"}`);
  const bad = rows.filter((r) => !r.ok);
  if (resolved.length === 0) fail("no @askdb packages found in the lockfile");
  if (bad.length) fail(`${bad.length} @askdb package(s) did not resolve to the target: ${bad.map((r) => r.package).join(", ")}`);
  console.log(`\nlab:use: all ${rows.length} @askdb packages resolve to the target's tarballs.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--restore")) return restore();
  const ifNeeded = args.includes("--if-needed");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail("usage: pnpm lab:use <. | path-to-checkout> [--if-needed] | --restore");
  if (/^(git:|npm:|registry$)/.test(target)) fail(`install mode "${target}" isn't implemented yet (see #244 and #257)`);

  if (ifNeeded && existsSync(TARGET_FILE) && existsSync(join(LAB, "node_modules", "@askdb", "core"))) {
    const current = JSON.parse(readFileSync(TARGET_FILE, "utf8"));
    console.log(`lab:use: already installed (${current.label}); skipping.`);
    return;
  }

  const root = resolve(target === "." ? REPO : target);
  const label = `checkout ${root} @ ${describeCheckout(root)}`;
  console.log(`lab:use: target = ${label}`);
  mkdirSync(STATE, { recursive: true });
  rmSync(join(STATE, "artifacts"), { recursive: true, force: true });

  const manifest = packCheckout(root);
  pinTo(manifest);
  run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: LAB });
  verify(manifest);

  writeFileSync(TARGET_FILE, `${JSON.stringify({ label, root, installedAt: new Date().toISOString(), packages: manifest }, null, 2)}\n`);
  console.log(`lab:use: package.json, pnpm-workspace.yaml and pnpm-lock.yaml now point at local tarballs.`);
  console.log(`         Don't commit them; \`pnpm lab:use --restore\` puts the committed baseline back.`);
}

main();
