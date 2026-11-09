#!/usr/bin/env node
// Restarts the prerelease counter when the Changesets pre tag changes, then checks the result.
// `pnpm version-packages` runs `reset` before `changeset version` and `check` after it.
//
// Changesets 3 numbers a prerelease from the package's current one, whatever its tag:
// in `rc` pre mode, `1.0.0-beta.46` becomes `1.0.0-rc.47` (`getPreVersion` in
// @changesets/assemble-release-plan), and a `fixed` group takes the highest number in the
// group. So `reset` sets the counter of each public package whose prerelease id isn't the
// pre tag to 0 (`1.0.0-beta.46` → `1.0.0-beta.0`), and `changeset version` then starts the
// new line at `<tag>.1` (#354). Once every package carries the pre tag, `reset` changes
// nothing.
//
// `check` fails if a public package still has a prerelease id other than the pre tag. That
// is a package `reset` touched but `changeset version` didn't bump: its `-beta.0` version
// isn't on npm, so release.yml would publish it once the Version PR merged.
//
// Only public packages count: they are the versions npm shows. Outside pre mode (no
// `.changeset/pre.json`, or `"mode": "exit"`), both commands do nothing. Pre mode without a
// tag, or a mode that is neither `pre` nor `exit`, fails both: Changesets treats any mode but
// `exit` as pre mode, so doing nothing there would let it version past the reset.
//
// Self-test: `node --test scripts/prerelease-counter.test.mjs` (CI's `preflight` job).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(name, version) {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`${name}: "${version}" is not a semver version`);
  return { release: match[1], id: match[2]?.split(".")[0] };
}

function preTag() {
  const file = join(".changeset", "pre.json");
  if (!existsSync(file)) return undefined;
  const { mode, tag } = JSON.parse(readFileSync(file, "utf8"));
  if (mode === "exit") return undefined;
  if (mode !== "pre") throw new Error(`${file}: mode ${JSON.stringify(mode)} is neither "pre" nor "exit"`);
  // Changesets would version `1.0.0-undefined.N`; fail before it does.
  if (typeof tag !== "string" || tag === "") throw new Error(`${file}: pre mode has no tag`);
  return tag;
}

function publicPackages() {
  const out = execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { encoding: "utf8" });
  return JSON.parse(out)
    .filter((p) => !p.private && p.name && p.version)
    .map(({ name, version, path }) => ({ name, version, path, ...parse(name, version) }));
}

function setVersion({ name, version, path }, next) {
  const file = join(path, "package.json");
  const text = readFileSync(file, "utf8");
  const field = `"version": ${JSON.stringify(version)}`;
  if (text.split(field).length !== 2) throw new Error(`${name}: expected one ${field} in ${file}`);
  writeFileSync(file, text.replace(field, `"version": ${JSON.stringify(next)}`));
}

const command = process.argv[2];
if (command !== "reset" && command !== "check") {
  console.error("usage: node scripts/prerelease-counter.mjs <reset|check>");
  process.exit(2);
}

const tag = preTag();
if (tag !== undefined) {
  const offTagPackages = publicPackages().filter(({ id }) => id !== undefined && id !== tag);
  if (command === "reset") {
    for (const pkg of offTagPackages) {
      const next = `${pkg.release}-${pkg.id}.0`;
      if (next === pkg.version) continue;
      setVersion(pkg, next);
      console.log(`prerelease-counter: ${pkg.name} ${pkg.version} -> ${next} (pre tag "${tag}")`);
    }
  } else if (offTagPackages.length > 0) {
    console.error(`prerelease-counter: these public packages aren't on the "${tag}" prerelease line:`);
    for (const { name, version } of offTagPackages) console.error(`  ${name}@${version}`);
    console.error("Most likely `reset` restarted its counter and `changeset version` didn't bump it. Add a changeset for it and rerun.");
    process.exit(1);
  }
}
