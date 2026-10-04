/**
 * `pnpm lab:use --check`: every @askdb package the lab installed comes from its target.
 *
 * Protects: the lab tests what it says it tests. For a registry target (`npm:<dist-tag>`,
 * `npm:askdb@<version>`, `registry`), every @askdb package in the lockfile must come from
 * the registry at the version the target pinned, and with the tarball's integrity when
 * the target recorded one; for a tarball target (`.`, a path, `git:<ref>`), from the
 * packed tarballs. A package the target didn't pin fails too.
 * Catches: a lab that reports `npm:latest` while one package is still a checkout tarball
 * left over from an earlier `lab:use .` (the checkout and npm share version numbers), a
 * transitive package that resolved at another published version than the release pins,
 * a registry copy slipping into a tarball install when an override goes missing, or a
 * `registry` install that kept npm's copy of a version the checkout publishes unchanged
 * (the local registry and npm share version numbers, so only the integrity tells them apart).
 * Not covered elsewhere: nothing else reads the lab's lockfile. `lab:use` runs this same
 * verification right after installing; without this test it is never shown to fail.
 * No production seam: `--check` is the documented `lab:use` command. The lockfiles below
 * are its input, in pnpm's lockfile v9 format as the lab's installs write it; the script
 * runs from a scratch copy of the lab so the real install isn't touched.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function useCheck(labDir: string) {
  const run = spawnSync("node", [join(labDir, "src", "use.mjs"), "--check"], { encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

const registry = (name: string, version: string, integrity = "sha512-AAAA") =>
  `  '${name}@${version}':\n    resolution: {integrity: ${integrity}}\n    engines: {node: '>=22.12'}\n`;
const tarball = (name: string, version: string) => {
  const file = `.lab/tarballs/${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  return `  '${name}@file:${file}':\n    resolution: {integrity: sha512-AAAA, tarball: file:${file}}\n    version: ${version}\n    engines: {node: '>=22.12'}\n`;
};

/** A scratch lab with `use.mjs`, a recorded target and a lockfile holding `entries`. */
function scratchLab(source: "registry" | "tarball", pins: Record<string, string>, entries: string[], integrity: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lab-use-check-"));
  scratch.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, ".lab"));
  cpSync(join(LAB, "src", "use.mjs"), join(dir, "src", "use.mjs"));
  const packages = Object.entries(pins).map(([name, version]) => ({ name, version, integrity: integrity[name] }));
  writeFileSync(join(dir, ".lab", "target.json"), JSON.stringify({ label: `test ${source} target`, source, packages }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\npackages:\n\n${entries.join("\n")}\nsnapshots:\n\n  pg@8.22.0: {}\n`);
  return dir;
}

const PINS = { "@askdb/core": "1.0.0-beta.42", askdb: "1.0.0-beta.42" };

describe("lab:use --check", () => {
  it("passes on the lab as installed", () => {
    const { status, out } = useCheck(LAB);
    expect(out).toMatch(/all \d+ @askdb packages resolve to/);
    expect(status).toBe(0);
  });

  it("passes a registry install at exactly the pinned versions and tarballs", () => {
    const lab = scratchLab("registry", PINS, [registry("@askdb/core", "1.0.0-beta.42"), registry("askdb", "1.0.0-beta.42")], { askdb: "sha512-AAAA" });
    const { status, out } = useCheck(lab);
    expect(out).toContain("all 2 @askdb packages resolve to the registry at the target's versions");
    expect(status).toBe(0);
  });

  it.each([
    {
      case: "a tarball in a registry install",
      source: "registry" as const,
      entries: [tarball("@askdb/core", "1.0.0-beta.42"), registry("askdb", "1.0.0-beta.42")],
      row: /@askdb\/core\s+1\.0\.0-beta\.42\s+tarball\s+<-- NOT FROM THE TARGET \(registry\)/,
    },
    {
      case: "another published version",
      source: "registry" as const,
      entries: [registry("@askdb/core", "1.0.0-beta.41"), registry("askdb", "1.0.0-beta.42")],
      row: /@askdb\/core\s+1\.0\.0-beta\.41\s+registry\s+<-- NOT THE TARGET VERSION \(1\.0\.0-beta\.42\)/,
    },
    {
      case: "a package the target never pinned",
      source: "registry" as const,
      entries: [registry("@askdb/core", "1.0.0-beta.42"), registry("askdb", "1.0.0-beta.42"), registry("@askdb/tui", "0.2.0-beta.1")],
      row: /@askdb\/tui\s+0\.2\.0-beta\.1\s+registry\s+<-- NOT PINNED BY THE TARGET/,
    },
    {
      case: "a registry copy in a tarball install",
      source: "tarball" as const,
      entries: [tarball("@askdb/core", "1.0.0-beta.42"), registry("askdb", "1.0.0-beta.42")],
      row: /askdb\s+1\.0\.0-beta\.42\s+registry\s+<-- NOT FROM THE TARGET \(tarball\)/,
    },
    {
      case: "another tarball at the pinned version",
      source: "registry" as const,
      entries: [registry("@askdb/core", "1.0.0-beta.42", "sha512-NPMS"), registry("askdb", "1.0.0-beta.42")],
      integrity: { "@askdb/core": "sha512-LOCAL" },
      row: /@askdb\/core\s+1\.0\.0-beta\.42\s+registry\s+<-- NOT THE TARGET'S TARBALL \(integrity sha512-LOCAL\)/,
    },
  ])("fails on $case, and names it", ({ source, entries, integrity, row }) => {
    const { status, out } = useCheck(scratchLab(source, PINS, entries, integrity));
    expect(out).toMatch(row);
    expect(out).toContain("1 @askdb package(s) did not resolve to the target");
    expect(status).toBe(1);
  });
});
