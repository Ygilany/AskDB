/**
 * `pnpm lab:use --if-needed .` (the install step of `lab:up`, and so of `lab:matrix`) keeps
 * the target `lab:use` last installed.
 *
 * Protects: the README's promise that `lab:matrix` "tests whatever `lab:use` last
 * installed". After `pnpm lab:use npm:latest` (or a version, or a git ref), `lab:matrix`
 * must test that install, which is how the older-target `n/a (capability: …)` cells and the
 * nightly run against `npm:latest` (#255) are produced. The restored baseline
 * (`lab:use --restore`, `lab:reset`) is the exception: it stands for "nothing chosen", so
 * `lab:up` installs the checkout, as on a fresh clone.
 * Catches: `--if-needed .` reinstalling the checkout over a chosen target (#302), so every
 * matrix silently tests the checkout; or the opposite, `lab:up` keeping the restored
 * baseline or a stale install of the checkout itself.
 * Not covered elsewhere: `use.test.ts` covers `--check` only, and CI always runs
 * `lab:use .` first, so no other test ever calls `--if-needed` with another target installed.
 * No production seam: `--if-needed` is `lab:up`'s documented install step. It runs from a
 * scratch copy of `use.mjs` with a recorded, verified target (a lockfile whose @askdb
 * packages match it), so the real install isn't touched. In the scratch the "checkout"
 * would be the temp directory's parent, which isn't an AskDB checkout, so a reinstall
 * fails fast instead of packing anything; the tests only need to see whether it was tried.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const PINS = { "@askdb/core": "1.0.0-beta.42", askdb: "1.0.0-beta.42" };
const registry = (name: string, version: string) =>
  `  '${name}@${version}':\n    resolution: {integrity: sha512-AAAA}\n    engines: {node: '>=22.12'}\n`;

/** A scratch lab whose recorded install, labelled `label`, verifies against its lockfile. */
function installedLab(label: string) {
  const dir = mkdtempSync(join(tmpdir(), "lab-use-if-needed-"));
  scratch.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, ".lab"));
  mkdirSync(join(dir, "node_modules"));
  cpSync(join(LAB, "src", "use.mjs"), join(dir, "src", "use.mjs"));
  const packages = Object.entries(PINS).map(([name, version]) => ({ name, version }));
  writeFileSync(join(dir, ".lab", "target.json"), JSON.stringify({ label, source: "registry", packages }));
  const entries = Object.entries(PINS).map(([name, version]) => registry(name, version));
  writeFileSync(join(dir, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\npackages:\n\n${entries.join("\n")}\nsnapshots:\n\n  pg@8.22.0: {}\n`);
  return dir;
}

function ifNeeded(lab: string) {
  const run = spawnSync("node", [join(lab, "src", "use.mjs"), "--if-needed", "."], { encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}`, recorded: existsSync(join(lab, ".lab", "target.json")) };
}

describe("lab:use --if-needed .", () => {
  it.each(["npm:latest (askdb@1.0.0-beta.42)", "npm:askdb@1.0.0-beta.40", "git:origin/main (0123abc)"])(
    "keeps a target lab:use chose (%s) instead of reinstalling the checkout",
    (label) => {
      const { status, out, recorded } = ifNeeded(installedLab(label));
      expect(out).toContain(`keeping the installed target (${label})`);
      expect(recorded).toBe(true);
      expect(status, out).toBe(0);
    },
  );

  it.each([
    ["the restored baseline", "committed baseline (npm:latest)"],
    ["a stale install of the checkout itself", // use.mjs finds the checkout from its own real path (/private/var on macOS), two levels up.
    (lab: string) => `checkout ${dirname(dirname(realpathSync(lab)))} @ 0000000`],
  ])("reinstalls over %s", (_what, label) => {
    const lab = installedLab("placeholder");
    const text = typeof label === "function" ? label(lab) : label;
    writeFileSync(join(lab, ".lab", "target.json"), JSON.stringify({ label: text, source: "registry", packages: Object.entries(PINS).map(([name, version]) => ({ name, version })) }));
    const { out, recorded } = ifNeeded(lab);
    expect(out).not.toContain("keeping the installed target");
    expect(out).not.toContain("already installed");
    // The reinstall started: the recorded target is cleared before installing.
    expect(recorded).toBe(false);
  });
});
