#!/usr/bin/env node
/**
 * `pnpm lab:use <target>`: choose which AskDB the lab installs, then install it the way
 * an outside project would.
 *
 *   pnpm lab:use .                    tarballs packed from this checkout
 *   pnpm lab:use <path>               tarballs packed from another checkout
 *   pnpm lab:use git:<ref>            tarballs packed from a branch, tag or commit (temporary worktree)
 *   pnpm lab:use npm:<dist-tag>       published packages under a dist-tag, e.g. npm:beta, npm:latest
 *   pnpm lab:use npm:askdb@<version>  a published CLI release and the exact @askdb/* versions it depends on
 *   pnpm lab:use --if-needed .        keep a verified install that is still current or that lab:use chose (used by lab:up)
 *   pnpm lab:use --check              re-verify the current install against its recorded target
 *   pnpm lab:use --restore            put the committed baseline (npm:latest) back, reinstalled from scratch
 *
 * Every @askdb/* package, including transitive dependencies of the lab's direct ones,
 * is pinned to the target through pnpm overrides, then verified from the lockfile: the
 * command fails if any of them resolved from anywhere else, or at another version.
 *
 * Dependency-free on purpose: it runs before anything is installed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(LAB, "../..");
const STATE = join(LAB, ".lab");
const TARBALLS = join(STATE, "tarballs");
const TARGET_FILE = join(STATE, "target.json");

/** The AskDB packages the lab imports or runs directly. Everything else arrives transitively. */
const DIRECT = ["@askdb/ai-openai", "@askdb/client", "@askdb/config", "@askdb/core", "@askdb/http-api", "askdb"];

const MANAGED = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
const BLOCK_BEGIN = "# lab:use overrides begin";
const BLOCK_END = "# lab:use overrides end";
const BLOCK_TARGET = "# lab:use target: ";

const isAskDb = (name) => name === "askdb" || name.startsWith("@askdb/");

function fail(message) {
  console.error(`lab:use: ${message}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

/**
 * Put the committed baseline back from any state, a half-finished `lab:use` included: the
 * managed manifests as committed, `.lab/` gone (tarballs, target, cached schema artifacts,
 * scratch projects), and a fresh install. Nothing else in the lab is touched.
 */
function restore() {
  run("git", ["-C", LAB, "checkout", "--", ...MANAGED]);
  rmSync(STATE, { recursive: true, force: true });
  // An interrupted install leaves node_modules partial, and pnpm calls a partial tree whose
  // lockfile matches "Already up to date"; verify() reads only the lockfile. Start clean.
  rmSync(join(LAB, "node_modules"), { recursive: true, force: true });
  const { label, pins } = readOverridesBlock();
  // The committed lockfile resolves from the registry, so it installs as committed.
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: LAB });
  const target = { label: `committed baseline (${label})`, source: "registry", packages: pins };
  verify(target);
  recordTarget(target);
  console.log(`lab:use: restored the committed baseline (${label}): published packages, not this checkout.`);
  console.log("         `pnpm lab:use .` installs this checkout.");
}

/** Pack a checkout with this repo's pack script (older checkouts may not have one). */
function requireCheckout(root) {
  if (!existsSync(join(root, "pnpm-workspace.yaml")) || !existsSync(join(root, "packages", "core"))) {
    fail(`${root} is not an AskDB checkout`);
  }
}

function packCheckout(root) {
  run("bash", [join(REPO, "scripts", "pack-tarballs.sh"), TARBALLS, "--root", root]);
  return JSON.parse(readFileSync(join(TARBALLS, "manifest.json"), "utf8"));
}

function describeCheckout(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();
  // Uncommitted edits get a content hash, so a changed working tree is a different target
  // (`--if-needed` then reinstalls instead of keeping stale tarballs). The lab's own files
  // are left out: they aren't packed, and `lab:use` itself rewrites its manifests.
  const outsideLab = ["--", ".", ":(exclude)examples/consumer-lab"];
  const status = git("status", "--porcelain", ...outsideLab);
  const dirty = status ? `+dirty.${createHash("sha256").update(status).update(git("diff", "HEAD", ...outsideLab)).digest("hex").slice(0, 8)}` : "";
  return `${git("rev-parse", "--short", "HEAD")}${dirty} (${git("rev-parse", "--abbrev-ref", "HEAD")})`;
}

/**
 * `git:<ref>`: check the ref out into a temporary worktree, install and pack it there
 * (pack-tarballs builds it), then remove the worktree. This repo's pack script is used
 * with `--root`, so a ref from before the script existed packs the same way.
 */
function packGitRef(ref) {
  let sha;
  try {
    sha = execFileSync("git", ["-C", REPO, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  } catch {
    fail(`git ref "${ref}" doesn't name a commit (fetch it first?)`);
  }
  const dir = mkdtempSync(join(tmpdir(), "askdb-lab-git-"));
  let added = false;
  try {
    run("git", ["-C", REPO, "worktree", "add", "--detach", dir, sha]);
    added = true;
    // Throw rather than fail(): process.exit would skip removing the worktree.
    if (!existsSync(join(dir, "packages", "core"))) throw new Error(`${ref} is not an AskDB checkout`);
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: dir });
    return { sha, manifest: packCheckout(dir) };
  } finally {
    // Cleanup must not mask the error that got us here, and the temp dir always goes.
    if (added) {
      try {
        execFileSync("git", ["-C", REPO, "worktree", "remove", "--force", dir], { stdio: "inherit" });
      } catch {
        console.error(`lab:use: couldn't remove the worktree at ${dir}; run \`git worktree prune\`.`);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Compare two semver versions, prereleases included (1.0.0-beta.9 < 1.0.0-beta.10 < 1.0.0). */
function compareVersions(a, b) {
  const [aMain, aPre] = a.split(/-(.*)/s);
  const [bMain, bPre] = b.split(/-(.*)/s);
  const parts = (s) => s.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const cmp = (x, y) => {
    const [xs, ys] = [parts(x), parts(y)];
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const [p, q] = [xs[i], ys[i]];
      if (p === q) continue;
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      if (typeof p === typeof q) return p < q ? -1 : 1;
      return typeof p === "number" ? -1 : 1;
    }
    return 0;
  };
  const main = cmp(aMain, bMain);
  if (main || aPre === bPre) return main;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return cmp(aPre, bPre);
}

/** `npm view <spec> --json`: the manifest, or the highest matching one when `spec` is a range. */
const viewed = new Map();
function npmView(spec) {
  if (!viewed.has(spec)) viewed.set(spec, npmViewUncached(spec));
  return viewed.get(spec);
}

function npmViewUncached(spec) {
  let out;
  try {
    out = execFileSync("npm", ["view", spec, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (/\bE404\b/.test(`${error.stdout}${error.stderr}`)) return undefined;
    fail(`npm view ${spec} failed:\n${error.stderr}`);
  }
  if (!out.trim()) return undefined;
  const parsed = JSON.parse(out);
  // A range returns every matching manifest; don't rely on npm's ordering, pick the highest.
  if (!Array.isArray(parsed)) return parsed;
  return parsed.reduce((best, m) => (compareVersions(m.version, best.version) > 0 ? m : best));
}

/**
 * The published packages to pin for an npm target: `seeds` (name → version) plus every
 * @askdb/* package reachable from them through dependencies and peer dependencies.
 * `versionFor(name, range)` picks the version of a package reached transitively.
 */
function resolvePublishedTree(seeds, versionFor) {
  const pins = new Map();
  const queue = [...seeds];
  while (queue.length) {
    const [name, version] = queue.shift();
    if (pins.has(name)) continue;
    const manifest = npmView(`${name}@${version}`);
    if (!manifest) fail(`${name}@${version} isn't published`);
    pins.set(name, manifest.version);
    for (const [dep, range] of Object.entries({ ...manifest.peerDependencies, ...manifest.dependencies })) {
      if (isAskDb(dep) && !pins.has(dep)) queue.push([dep, versionFor(dep, range)]);
    }
  }
  return [...pins].map(([name, version]) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name));
}

/** `npm:<dist-tag>`: every @askdb package at that tag; one without the tag keeps what its dependent asks for. */
function resolveDistTag(tag) {
  const tagged = (name) => npmView(`${name}@${tag}`)?.version;
  const seeds = DIRECT.map((name) => [name, tagged(name)]).filter(([, version]) => version);
  if (!seeds.length) fail(`no AskDB package is published under the "${tag}" dist-tag`);
  return resolvePublishedTree(seeds, (name, range) => tagged(name) ?? range);
}

/**
 * `npm:askdb@<version>`: package versions aren't in lockstep, so the CLI release decides.
 * askdb pins its @askdb/* dependencies exactly; those versions are the target.
 */
function resolveCliRelease(version) {
  if (!npmView(`askdb@${version}`)) fail(`askdb@${version} isn't published`);
  return resolvePublishedTree([["askdb", version]], (_name, range) => range);
}

/**
 * Point the lab at the target: direct deps in package.json, and an override for every
 * target package in pnpm-workspace.yaml. `packages` is `[{ name, spec }]`.
 */
function pinTo(packages, label) {
  const spec = new Map(packages.map((p) => [p.name, p.spec]));

  const pkgPath = join(LAB, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.dependencies = { ...pkg.dependencies };
  for (const name of DIRECT) {
    if (spec.has(name)) pkg.dependencies[name] = spec.get(name);
    else {
      delete pkg.dependencies[name];
      console.log(`lab:use: the target has no ${name}; leaving it out of package.json.`);
    }
  }
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const wsPath = join(LAB, "pnpm-workspace.yaml");
  const ws = readFileSync(wsPath, "utf8");
  const begin = ws.indexOf(BLOCK_BEGIN);
  const end = ws.indexOf(BLOCK_END);
  if (begin < 0 || end < begin) fail("pnpm-workspace.yaml has lost its lab:use overrides block");
  const lines = [`${BLOCK_TARGET}${label}`, "overrides:", ...packages.map((p) => `  "${p.name}": "${p.spec}"`)];
  writeFileSync(wsPath, `${ws.slice(0, begin + BLOCK_BEGIN.length)}\n${lines.join("\n")}\n${ws.slice(end)}`);
}

/** The target label and exact-version pins recorded in pnpm-workspace.yaml's overrides block. */
function readOverridesBlock() {
  const ws = readFileSync(join(LAB, "pnpm-workspace.yaml"), "utf8");
  const block = ws.slice(ws.indexOf(BLOCK_BEGIN), ws.indexOf(BLOCK_END));
  const label = block.split("\n").find((l) => l.startsWith(BLOCK_TARGET))?.slice(BLOCK_TARGET.length);
  const pins = [...block.matchAll(/^ {2}"([^"]+)": "([^"]+)"$/gm)].map(([, name, version]) => ({ name, version }));
  if (!label || !pins.length) fail("the committed pnpm-workspace.yaml has no lab:use target to restore");
  return { label, pins };
}

/**
 * Every @askdb/* (and `askdb`) package in the lockfile, with where it resolved from.
 * pnpm lockfile v9 keys packages as `name@<version-or-spec>`; a tarball install keys
 * them as `name@file:<path>`, a registry install as `name@<version>` with an integrity
 * hash and no `tarball:` URL.
 */
function resolvedAskDbPackages() {
  const lock = readFileSync(join(LAB, "pnpm-lock.yaml"), "utf8");
  const start = lock.indexOf("\npackages:\n");
  if (start < 0) return [];
  const end = lock.indexOf("\nsnapshots:\n", start);
  const section = lock.slice(start, end < 0 ? undefined : end);
  const found = new Map();
  for (const match of section.matchAll(/^ {2}'?((?:@askdb\/[\w.-]+)|askdb)@([^':\n]+(?::[^':\n]+)?)'?:\n((?: {4}.*\n)*)/gm)) {
    const [, name, spec, body] = match;
    const version = /^ {4}version: (\S+)/m.exec(body)?.[1] ?? spec;
    const source = spec.startsWith("file:")
      ? "tarball"
      : /^\d/.test(spec) && /resolution: \{integrity:/.test(body) && !/tarball:/.test(body)
        ? "registry"
        : spec;
    found.set(`${name}@${spec}`, { name, spec, version, source });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Print the resolved-version table and fail unless every @askdb package in the lockfile
 * comes from `target`: `{ source: "tarball" | "registry", packages: [{ name, version }] }`.
 */
/** Print the resolved-version table; on a mismatch, run `beforeFail` (e.g. a rollback) and exit. */
function verify(target, beforeFail = () => {}) {
  const { rows, bad } = compareToTarget(target);
  if (rows.length === 0) {
    beforeFail();
    fail("no @askdb packages found in the lockfile");
  }
  const width = Math.max(...rows.map((r) => r.package.length), 7);
  console.log(`\n${"package".padEnd(width)}  version              source`);
  for (const r of rows) console.log(`${r.package.padEnd(width)}  ${r.version.padEnd(20)} ${r.source}${r.problem ? `   <-- ${r.problem}` : ""}`);
  if (bad.length) {
    beforeFail();
    fail(`${bad.length} @askdb package(s) did not resolve to the target: ${bad.map((r) => r.package).join(", ")}`);
  }
  const where = target.source === "tarball" ? "the target's tarballs" : "the registry at the target's versions";
  console.log(`\nlab:use: all ${rows.length} @askdb packages resolve to ${where}.`);
}

function compareToTarget(target) {
  const resolved = resolvedAskDbPackages();
  const expected = new Map(target.packages.map((p) => [p.name, p.version]));
  const rows = resolved.map((r) => {
    const want = expected.get(r.name);
    const problem =
      want === undefined ? "NOT PINNED BY THE TARGET"
      : r.source !== target.source ? `NOT FROM THE TARGET (${target.source})`
      : r.version !== want ? `NOT THE TARGET VERSION (${want})`
      : "";
    return { package: r.name, version: r.version, source: r.source, problem };
  });
  // Each of the lab's direct dependencies the target has must be installed at all; a
  // package missing from the lockfile (or resolved only through a `link:` importer)
  // would otherwise pass unseen. Older releases may lack some (see pinTo).
  for (const name of DIRECT) {
    if (expected.has(name) && !resolved.some((r) => r.name === name)) rows.push({ package: name, version: "-", source: "-", problem: "MISSING FROM THE LOCKFILE" });
  }
  return { rows, bad: rows.filter((r) => r.problem) };
}

/** The recorded target, when the lab is installed and its lockfile still matches it. */
function installedTarget() {
  if (!existsSync(TARGET_FILE) || !existsSync(join(LAB, "node_modules"))) return undefined;
  const target = JSON.parse(readFileSync(TARGET_FILE, "utf8"));
  const { rows, bad } = compareToTarget(target);
  return rows.length && !bad.length ? target : undefined;
}

/**
 * Whether `--if-needed <target>` keeps the recorded, verified install. It keeps one that is
 * still what `target` would install (a checkout at the same commit and uncommitted edits),
 * and one that someone chose with `lab:use` (a published version, a git ref, another path),
 * so `lab:matrix` tests whatever `lab:use` last installed. It reinstalls a stale install of
 * `target` itself, and the restored baseline (`lab:use --restore`, `lab:reset`), which
 * stands for "nothing chosen yet", as on a fresh clone.
 */
function keepsInstall(recorded, target) {
  if (sameTarget(recorded, target)) return true;
  if (recorded.label.startsWith("committed baseline")) return false;
  if (target.startsWith("npm:") || target.startsWith("git:") || target === "registry") return false;
  const root = resolve(target === "." ? REPO : target);
  return !recorded.label.startsWith(`checkout ${root} @ `);
}

/** Whether the recorded install is what `target` would install now, without packing anything. */
function sameTarget(recorded, target) {
  if (target.startsWith("npm:") || target.startsWith("git:") || target === "registry") return false;
  const root = resolve(target === "." ? REPO : target);
  if (!existsSync(join(root, "packages", "core"))) return false;
  return recorded.label === `checkout ${root} @ ${describeCheckout(root)}`;
}

function recordTarget(target) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(TARGET_FILE, `${JSON.stringify({ ...target, installedAt: new Date().toISOString() }, null, 2)}\n`);
}

function check() {
  if (!existsSync(TARGET_FILE)) fail("the lab isn't installed; run `pnpm lab:use <target>` first");
  const target = JSON.parse(readFileSync(TARGET_FILE, "utf8"));
  console.log(`lab:use: target = ${target.label}`);
  verify(target);
}

/** Resolve `target` to `{ label, source, packages: [{ name, version, spec }] }`, packing tarballs if needed. */
function resolveTarget(target) {
  if (target === "registry") fail(`install mode "registry" isn't implemented yet (see #257)`);

  if (target.startsWith("npm:")) {
    const what = target.slice("npm:".length);
    const release = /^askdb@(.+)$/.exec(what);
    if (!what || (what.includes("@") && !release)) fail(`"${target}" isn't npm:<dist-tag> or npm:askdb@<version>`);
    console.log(`lab:use: target = ${target}`);
    const packages = release ? resolveCliRelease(release[1]) : resolveDistTag(what);
    return { label: target, source: "registry", packages: packages.map((p) => ({ ...p, spec: p.version })) };
  }

  let label;
  let manifest;
  let thisCheckout = false;
  if (target.startsWith("git:")) {
    const ref = target.slice("git:".length);
    console.log(`lab:use: target = git ${ref}`);
    const packed = packGitRef(ref);
    label = `git ${ref} @ ${packed.sha.slice(0, 7)}`;
    manifest = packed.manifest;
  } else {
    const root = resolve(target === "." ? REPO : target);
    requireCheckout(root);
    thisCheckout = root === REPO;
    label = `checkout ${root} @ ${describeCheckout(root)}`;
    console.log(`lab:use: target = ${label}`);
    manifest = packCheckout(root);
  }
  const spec = (entry) => `file:${relative(LAB, join(TARBALLS, entry.file))}`;
  return { label, source: "tarball", thisCheckout, packages: manifest.map((p) => ({ name: p.name, version: p.version, spec: spec(p) })) };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--restore")) return restore();
  if (args.includes("--check")) return check();
  const ifNeeded = args.includes("--if-needed");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail("usage: pnpm lab:use <. | path | git:<ref> | npm:<dist-tag> | npm:askdb@<version>> [--if-needed] | --check | --restore");

  // `--if-needed`: see keepsInstall.
  const current = ifNeeded && installedTarget();
  if (current && keepsInstall(current, target)) {
    if (sameTarget(current, target)) console.log(`lab:use: already installed (${current.label}); skipping.`);
    else console.log(`lab:use: keeping the installed target (${current.label}); \`pnpm lab:use ${target}\` switches to ${target === "." ? "this checkout" : target}.`);
    return;
  }

  // From here until the new target verifies, the lab is not installed: target.json is
  // written only after a successful install and verification.
  rmSync(TARGET_FILE, { force: true });
  mkdirSync(STATE, { recursive: true });
  const resolved = resolveTarget(target);
  rmSync(join(STATE, "artifacts"), { recursive: true, force: true });
  // If the install fails, put the manifests back rather than leave them half-switched.
  const before = new Map(MANAGED.map((f) => [f, existsSync(join(LAB, f)) ? readFileSync(join(LAB, f), "utf8") : undefined]));
  const rollBack = () => {
    for (const [file, text] of before) {
      if (text === undefined) rmSync(join(LAB, file), { force: true });
      else writeFileSync(join(LAB, file), text);
    }
  };
  pinTo(resolved.packages, resolved.label);
  try {
    run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: LAB });
  } catch {
    rollBack();
    fail(`pnpm install failed for ${resolved.label}. The lab's manifests are back as they were, but node_modules may be partial,\n` +
      "so the lab is marked not installed. Fix the cause and rerun `pnpm lab:use`, or `pnpm lab:use --restore`.");
  }
  const recorded = {
    label: resolved.label,
    source: resolved.source,
    // The lab's scenarios are written against this checkout's docs, so it must have every capability they name.
    thisCheckout: resolved.thisCheckout === true,
    packages: resolved.packages.map(({ name, version }) => ({ name, version })),
  };
  verify(recorded, () => {
    rollBack();
    console.error("lab:use: the lab's manifests are back as they were; the lab is marked not installed.");
  });
  recordTarget(recorded);

  if (resolved.source === "tarball") {
    console.log(`lab:use: package.json, pnpm-workspace.yaml and pnpm-lock.yaml now point at local tarballs.`);
    console.log(`         Don't commit them; \`pnpm lab:use --restore\` puts the committed baseline back.`);
  } else {
    console.log(`lab:use: package.json, pnpm-workspace.yaml and pnpm-lock.yaml now pin ${resolved.label}.`);
    console.log(`         Commit them only to refresh the baseline, and only from \`pnpm lab:use npm:latest\`.`);
  }
}

main();
