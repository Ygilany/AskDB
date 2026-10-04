#!/usr/bin/env node
/**
 * `pnpm lab:use <target>`: choose which AskDB the lab installs, then install it the way
 * an outside project would.
 *
 *   pnpm lab:use .                    tarballs packed from this checkout
 *   pnpm lab:use <path>               tarballs packed from another checkout
 *   pnpm lab:use git:<ref>            tarballs packed from a branch, tag or commit (temporary worktree)
 *   pnpm lab:use npm:<dist-tag>       published packages under a dist-tag, e.g. npm:latest
 *   pnpm lab:use npm:askdb@<version>  a published CLI release and the exact @askdb/* versions it depends on
 *   pnpm lab:use registry             this checkout, published to a local verdaccio the way release.yml publishes to npm
 *   pnpm lab:use --if-needed .        keep a verified install that is still current or that lab:use chose (used by lab:up)
 *   pnpm lab:use --check              re-verify the current install against its recorded target
 *   pnpm lab:use --restore            put the committed baseline (npm:latest) back, reinstalled from scratch
 *
 * Every @askdb/* package, including transitive dependencies of the lab's direct ones,
 * is pinned to the target through pnpm overrides, then verified from the lockfile: the
 * command fails if any of them resolved from anywhere else, at another version, or (for a
 * registry target that recorded it) as another tarball. A `registry` install's files are
 * also compared with the tarballs the registry served.
 *
 * Dependency-free on purpose: it runs before anything is installed.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(LAB, "../..");
const STATE = join(LAB, ".lab");
const TARBALLS = join(STATE, "tarballs");
const TARGET_FILE = join(STATE, "target.json");

/** The AskDB packages the lab imports or runs directly. Everything else arrives transitively. */
const DIRECT = ["@askdb/ai-openai", "@askdb/client", "@askdb/config", "@askdb/core", "@askdb/http-api", "@askdb/studio", "askdb"];

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
    pins.set(name, { version: manifest.version, integrity: manifest.dist?.integrity });
    for (const [dep, range] of Object.entries({ ...manifest.peerDependencies, ...manifest.dependencies })) {
      if (isAskDb(dep) && !pins.has(dep)) queue.push([dep, versionFor(dep, range)]);
    }
  }
  return [...pins].map(([name, pin]) => ({ name, ...pin })).sort((a, b) => a.name.localeCompare(b.name));
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
 * `registry`: a verdaccio (compose.yml's `registry` profile) on 127.0.0.1, with its storage in
 * a temp dir, for this run only. It serves AskDB only from what is published to it and
 * proxies npm for everything else. It is removed, storage included, when the process exits,
 * however it exits. Returns the URL, the npm config to publish with, and pnpm's flags to
 * install from it.
 */
async function startRegistry() {
  const port = Number(process.env.LAB_REGISTRY_PORT ?? 4873);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`LAB_REGISTRY_PORT=${process.env.LAB_REGISTRY_PORT} isn't a port`);
  await new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => fail(`port ${port} is in use; set LAB_REGISTRY_PORT to a free one (a registry left by a killed run is the compose project askdb-lab-registry-${port})`));
    // Every interface, not only loopback: a listener on 0.0.0.0 would clash with Docker's too.
    probe.listen(port, () => probe.close(done));
  });
  const url = `http://127.0.0.1:${port}/`;
  const dir = mkdtempSync(join(tmpdir(), "askdb-lab-registry-"));
  const storage = join(dir, "storage");
  mkdirSync(storage);
  const compose = (...args) =>
    execFileSync("docker", ["compose", "-f", join(LAB, "compose.yml"), "-p", `askdb-lab-registry-${port}`, "--profile", "registry", ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, LAB_REGISTRY_PORT: String(port), LAB_REGISTRY_STORAGE: storage, LAB_REGISTRY_USER: `${process.getuid()}:${process.getgid()}` },
    });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      compose("down", "--volumes", "--timeout", "1");
    } catch {
      console.error(`lab:use: couldn't remove the registry; run \`docker compose -p askdb-lab-registry-${port} down\`.`);
    }
    rmSync(dir, { recursive: true, force: true });
  };
  // `exit` listeners run on process.exit (fail() included); a signal needs turning into an exit first.
  process.on("exit", stop);
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(signal, () => process.exit(code));

  console.log(`lab:use: local registry at ${url} (storage ${storage})`);
  compose("up", "--detach", "--quiet-pull");
  const deadline = Date.now() + 60_000;
  while (!(await fetch(`${url}-/ping`).then((r) => r.ok, () => false))) {
    if (Date.now() > deadline) fail(`the local registry at ${url} didn't answer within a minute; see \`docker compose -p askdb-lab-registry-${port} logs\``);
    await new Promise((done) => setTimeout(done, 250));
  }
  // Sign up the one user verdaccio.yaml allows; its token goes only into the npm config below.
  const signup = await fetch(`${url}-/user/org.couchdb.user:lab`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "lab", password: randomBytes(16).toString("hex") }),
  });
  const token = signup.ok && (await signup.json()).token;
  if (!token) fail(`couldn't sign up a publisher on the local registry (HTTP ${signup.status})`);
  const npmrc = join(dir, "npmrc");
  writeFileSync(npmrc, `registry=${url}\n//127.0.0.1:${port}/:_authToken=${token}\n`);
  return { url, npmrc, stop, install: ["--registry", url, "--cache-dir", join(dir, "pnpm-cache")] };
}

/**
 * The environment `pnpm publish` runs in: no npm or pnpm config from the caller's
 * environment (npm/pnpm config variables, CI tokens, GitHub's OIDC request), and the npm
 * config from `startRegistry` in place of the user's ~/.npmrc, so no credential for another
 * registry is loaded. Then the guard: in that environment, from the checkout, pnpm's config
 * must name no registry but the local one and hold no credential for any other host, and no
 * package may set `publishConfig.registry` (pnpm prefers it to `--registry`). A project
 * `.npmrc` is the checkout's own, so it is checked, not replaced.
 */
function publishEnv(root, registry) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(npm_config_|pnpm_config_)|^(NPM_TOKEN|NODE_AUTH_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/i.test(key)),
  );
  env.npm_config_userconfig = registry.npmrc;
  const config = JSON.parse(execFileSync("pnpm", ["config", "list", "--json"], { cwd: root, env, encoding: "utf8" }));
  const host = `//${new URL(registry.url).host}/`;
  const problems = Object.entries(config)
    .filter(([key, value]) => (["registry", "@askdb:registry"].includes(key) ? value !== registry.url : key.startsWith("//") && !key.startsWith(host)))
    .map(([key]) => `${key} in pnpm's config`);
  const projects = JSON.parse(execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { cwd: root, env, encoding: "utf8" }));
  for (const project of projects) {
    if (project.private) continue;
    const manifest = JSON.parse(readFileSync(join(project.path, "package.json"), "utf8"));
    for (const key of Object.keys(manifest.publishConfig ?? {}).filter((k) => /registry$/i.test(k))) problems.push(`${manifest.name}'s publishConfig.${key}`);
  }
  if (problems.length) fail(`refusing to publish: pnpm could send the publish, or a credential, somewhere other than ${registry.url}: ${problems.join(", ")}`);
  return env;
}

/**
 * GET from the local registry; undefined on a 404. The publish outlasts verdaccio's
 * keep-alive timeout, so the first request after it can land on a socket the server
 * already closed: a network error is retried.
 */
async function registryGet(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return undefined;
      if (!res.ok) fail(`GET ${url} answered HTTP ${res.status}`);
      return res;
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 3) fail(`GET ${url} failed: ${error.cause?.message ?? error.message}`);
    }
  }
}

/**
 * Publish this checkout to the local registry with release.yml's publish command and flags,
 * after the build `pack-tarballs.sh` runs, then keep the tarballs the registry serves in
 * `.lab/tarballs/` (for installs outside the lab, once the registry is gone) and return
 * each package with the integrity the registry recorded.
 */
async function publishToRegistry(registry) {
  const env = publishEnv(REPO, registry);
  run("pnpm", ["-C", REPO, "build"]);
  const summaryFile = join(REPO, "pnpm-publish-summary.json");
  rmSync(summaryFile, { force: true });
  try {
    run("pnpm", ["-r", "publish", "--access", "public", "--no-git-checks", "--tag", "latest", "--report-summary", "--registry", registry.url], { cwd: REPO, env });
  } catch {
    rmSync(summaryFile, { force: true });
    fail(`pnpm publish to the local registry failed (see above); the registry is being removed.`);
  }
  const { publishedPackages } = JSON.parse(readFileSync(summaryFile, "utf8"));
  rmSync(summaryFile, { force: true });
  if (!publishedPackages?.length) fail("pnpm publish published nothing");

  rmSync(TARBALLS, { recursive: true, force: true });
  mkdirSync(TARBALLS, { recursive: true });
  const packages = [];
  const manifest = [];
  for (const { name, version } of publishedPackages) {
    const meta = await (await registryGet(`${registry.url}${name.replace("/", "%2f")}`))?.json();
    const dist = meta?.versions?.[version]?.dist;
    if (!dist?.integrity) fail(`the local registry doesn't serve ${name}@${version}, which pnpm says it published`);
    const served = await registryGet(dist.tarball);
    if (!served) fail(`the local registry doesn't serve ${dist.tarball}, ${name}@${version}'s tarball`);
    const tarball = Buffer.from(await served.arrayBuffer());
    const [algorithm, digest] = dist.integrity.split(/-(.*)/s);
    if (createHash(algorithm).update(tarball).digest("base64") !== digest) fail(`${name}@${version}'s tarball doesn't match the integrity the local registry recorded`);
    const file = basename(new URL(dist.tarball).pathname);
    writeFileSync(join(TARBALLS, file), tarball);
    manifest.push({ name, version, file });
    packages.push({ name, version, integrity: dist.integrity, spec: version });
  }
  writeFileSync(join(TARBALLS, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Before a registry install: drop every AskDB package from the lockfile's `packages:` and
 * `snapshots:`, so the install resolves each one afresh from the target. pnpm keeps a locked
 * package whose version still satisfies its spec and installs it from its store by
 * integrity, so a `registry` install would otherwise keep npm's tarball (or an earlier
 * publish's) under the same version, and an npm install after it the local registry's.
 * Importers and other packages' dependency lists still name the versions; pnpm fills them in.
 * (A tarball target needs none of this: its `file:` specs are new to the lockfile.)
 */
function forgetLockedAskDb() {
  const path = join(LAB, "pnpm-lock.yaml");
  if (!existsSync(path)) return;
  console.log("lab:use: dropping the lockfile's AskDB entries so pnpm resolves them from the target; it will call the lockfile broken.");
  const lock = readFileSync(path, "utf8");
  writeFileSync(path, lock.replace(/^ {2}'?(?:@askdb\/[\w.-]+|askdb)@[^\n]*\n(?: {4}[^\n]*\n)*\n?/gm, ""));
}

/**
 * The lab's pnpm-workspace.yaml, split around its lab:use overrides block. Fails if the
 * block is missing or isn't inside the file's top-level `overrides:` map, which holds the
 * lab's hand-written third-party pins above the block. `main` calls this before it changes
 * anything, so a malformed file can't leave the lab half-switched.
 */
function readWorkspace() {
  const ws = readFileSync(join(LAB, "pnpm-workspace.yaml"), "utf8");
  const begin = ws.indexOf(BLOCK_BEGIN);
  const end = ws.indexOf(BLOCK_END);
  if (begin < 0 || end < begin) fail("pnpm-workspace.yaml has lost its lab:use overrides block");
  const lastKey = ws.slice(0, begin).split("\n").filter((l) => /^[^\s#]/.test(l)).pop();
  if (lastKey !== "overrides:") fail("pnpm-workspace.yaml's lab:use overrides block must sit inside its top-level `overrides:` map");
  return { head: ws.slice(0, begin + BLOCK_BEGIN.length), tail: ws.slice(end) };
}

/**
 * Point the lab at the target: direct deps in package.json, and an override for every
 * target package in pnpm-workspace.yaml (`workspace` from readWorkspace). `packages` is
 * `[{ name, spec }]`.
 */
function pinTo(packages, label, workspace) {
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

  const lines = [`${BLOCK_TARGET}${label}`, ...packages.map((p) => `  "${p.name}": "${p.spec}"`)];
  writeFileSync(join(LAB, "pnpm-workspace.yaml"), `${workspace.head}\n${lines.join("\n")}\n${workspace.tail}`);
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
    const integrity = /resolution: \{integrity: ([^,}\s]+)/.exec(body)?.[1];
    const source = spec.startsWith("file:")
      ? "tarball"
      : /^\d/.test(spec) && /resolution: \{integrity:/.test(body) && !/tarball:/.test(body)
        ? "registry"
        : spec;
    found.set(`${name}@${spec}`, { name, spec, version, integrity, source });
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
  const where =
    target.source === "tarball" ? "the target's tarballs"
    : target.localRegistry ? "the tarballs published to the local registry"
    : "the registry at the target's versions";
  console.log(`\nlab:use: all ${rows.length} @askdb packages resolve to ${where}.`);
}

function compareToTarget(target) {
  const resolved = resolvedAskDbPackages();
  const notAsPublished = target.localRegistry ? installedNotAsPublished(new Set(resolved.map((r) => r.name))) : new Set();
  const expected = new Map(target.packages.map((p) => [p.name, p]));
  const rows = resolved.map((r) => {
    const want = expected.get(r.name);
    // A registry target may record each tarball's integrity: the same version number can be
    // another tarball (npm's copy, or an earlier publish to the local registry).
    const problem =
      want === undefined ? "NOT PINNED BY THE TARGET"
      : r.source !== target.source ? `NOT FROM THE TARGET (${target.source})`
      : r.version !== want.version ? `NOT THE TARGET VERSION (${want.version})`
      : want.integrity && r.integrity !== want.integrity ? `NOT THE TARGET'S TARBALL (integrity ${want.integrity})`
      : notAsPublished.has(r.name) ? "INSTALLED FILES AREN'T THE PUBLISHED TARBALL"
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

/**
 * For a `registry` target: of the AskDB packages in the lockfile (`names`), those that
 * aren't installed as the tarball the registry served, kept in `.lab/tarballs/`: no kept
 * tarball, no `node_modules/.pnpm` dir, or a dir with other files. pnpm keeps a package dir
 * whose path didn't change even when the lockfile names another tarball for it, so the
 * lockfile alone can't show this.
 */
function installedNotAsPublished(names) {
  const virtualStore = join(LAB, "node_modules", ".pnpm");
  const manifestFile = join(TARBALLS, "manifest.json");
  if (!existsSync(virtualStore) || !existsSync(manifestFile)) return new Set(names);
  const kept = new Map(JSON.parse(readFileSync(manifestFile, "utf8")).map((p) => [p.name, p]));
  // A package's own files; pnpm may add a `node_modules/` (bin links), which no tarball ships.
  const files = (dir) =>
    new Map(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .filter((path) => !path.startsWith(`node_modules${sep}`))
        .map((path) => [path, readFileSync(join(dir, path))]),
    );
  const scratch = mkdtempSync(join(tmpdir(), "askdb-lab-check-"));
  const differ = new Set();
  try {
    for (const name of names) {
      const { version, file } = kept.get(name) ?? {};
      const prefix = `${name.replace("/", "+")}@${version}`;
      const dirs = file ? readdirSync(virtualStore).filter((d) => d === prefix || d.startsWith(`${prefix}_`)) : [];
      if (!dirs.length) {
        differ.add(name);
        continue;
      }
      const unpacked = join(scratch, file);
      mkdirSync(unpacked);
      execFileSync("tar", ["-xzf", join(TARBALLS, file), "-C", unpacked]);
      const want = files(join(unpacked, "package"));
      for (const dir of dirs) {
        const got = files(join(virtualStore, dir, "node_modules", name));
        if (got.size !== want.size || [...want].some(([path, bytes]) => !got.get(path)?.equals(bytes))) differ.add(name);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return differ;
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

/**
 * Resolve `target` to `{ label, source, packages: [{ name, version, spec, integrity? }] }`,
 * packing tarballs or publishing to the local registry if needed. `install` is extra
 * `pnpm install` flags.
 */
async function resolveTarget(target) {
  if (target === "registry") {
    requireCheckout(REPO);
    const label = `registry: checkout ${REPO} @ ${describeCheckout(REPO)}`;
    console.log(`lab:use: target = ${label}`);
    const registry = await startRegistry();
    const packages = await publishToRegistry(registry);
    return { label, source: "registry", localRegistry: true, thisCheckout: true, packages, install: registry.install, stop: registry.stop };
  }

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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--restore")) return restore();
  if (args.includes("--check")) return check();
  const ifNeeded = args.includes("--if-needed");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail("usage: pnpm lab:use <. | path | git:<ref> | npm:<dist-tag> | npm:askdb@<version> | registry> [--if-needed] | --check | --restore");

  // `--if-needed`: see keepsInstall.
  const current = ifNeeded && installedTarget();
  if (current && keepsInstall(current, target)) {
    if (sameTarget(current, target)) console.log(`lab:use: already installed (${current.label}); skipping.`);
    else console.log(`lab:use: keeping the installed target (${current.label}); \`pnpm lab:use ${target}\` switches to ${target === "." ? "this checkout" : target}.`);
    return;
  }

  // Before anything changes: a malformed workspace file fails here, with the lab as it was.
  const workspace = readWorkspace();
  // From here until the new target verifies, the lab is not installed: target.json is
  // written only after a successful install and verification.
  rmSync(TARGET_FILE, { force: true });
  mkdirSync(STATE, { recursive: true });
  const resolved = await resolveTarget(target);
  rmSync(join(STATE, "artifacts"), { recursive: true, force: true });
  // If the install fails, put the manifests back rather than leave them half-switched.
  const before = new Map(MANAGED.map((f) => [f, existsSync(join(LAB, f)) ? readFileSync(join(LAB, f), "utf8") : undefined]));
  const rollBack = () => {
    for (const [file, text] of before) {
      if (text === undefined) rmSync(join(LAB, file), { force: true });
      else writeFileSync(join(LAB, file), text);
    }
  };
  pinTo(resolved.packages, resolved.label, workspace);
  if (resolved.source === "registry") {
    forgetLockedAskDb();
    // pnpm also keeps an installed package dir whose path is unchanged, whatever tarball the
    // lockfile now names for it (the check below would catch it). Start clean, as --restore does.
    rmSync(join(LAB, "node_modules"), { recursive: true, force: true });
  }
  try {
    run("pnpm", ["install", "--no-frozen-lockfile", ...(resolved.install ?? [])], { cwd: LAB });
  } catch {
    rollBack();
    fail(`pnpm install failed for ${resolved.label}. The lab's manifests are back as they were, but node_modules may be partial,\n` +
      "so the lab is marked not installed. Fix the cause and rerun `pnpm lab:use`, or `pnpm lab:use --restore`.");
  }
  resolved.stop?.();
  const recorded = {
    label: resolved.label,
    source: resolved.source,
    // The lab's scenarios are written against this checkout's docs, so it must have every capability they name.
    thisCheckout: resolved.thisCheckout === true,
    // Outside the lab (a scratch project), these versions resolve from npm: use `.lab/tarballs/`.
    ...(resolved.localRegistry && { localRegistry: true }),
    packages: resolved.packages.map(({ name, version, integrity }) => ({ name, version, integrity })),
  };
  verify(recorded, () => {
    rollBack();
    console.error("lab:use: the lab's manifests are back as they were; the lab is marked not installed.");
  });
  recordTarget(recorded);

  if (resolved.source === "tarball" || resolved.localRegistry) {
    const at = resolved.localRegistry ? "this checkout's versions, as published to the local registry (now removed)" : "local tarballs";
    console.log(`lab:use: package.json, pnpm-workspace.yaml and pnpm-lock.yaml now point at ${at}.`);
    console.log(`         Don't commit them; \`pnpm lab:use --restore\` puts the committed baseline back.`);
  } else {
    console.log(`lab:use: package.json, pnpm-workspace.yaml and pnpm-lock.yaml now pin ${resolved.label}.`);
    console.log(`         Commit them only to refresh the baseline, and only from \`pnpm lab:use npm:latest\`.`);
  }
}

await main();
