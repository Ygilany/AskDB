/**
 * `pnpm lab:use npm:askdb@<version>`: resolving a release's dependency tree, a failed
 * install, and a malformed pnpm-workspace.yaml.
 *
 * Protects: (1) a dependency range in a published manifest resolves to the highest
 * matching version by semver, so prereleases like `1.0.0-beta.10` sort above
 * `1.0.0-beta.9`, whatever order `npm view` lists them in; (2) when `pnpm install` fails
 * after the manifests were rewritten, they are put back as they were and the lab is
 * marked not installed (no `.lab/target.json`), instead of left half-switched; (3) the
 * pins go into the workspace's existing `overrides:` map, keeping its third-party pins;
 * (4) a workspace file whose lab:use block is missing, or outside that map, fails the
 * switch before anything changes: manifests and the recorded target stay as they were.
 * Catches: a lexical or npm-order pick of a range (pinning beta.9 over beta.10), a
 * failed switch that leaves `file:` or registry pins behind while the lab still claims
 * the old target, a switch that writes a second `overrides:` key next to the lab's
 * third-party pins (pnpm rejects the duplicate key, so every switch would fail), and a
 * workspace check that runs after package.json was already switched.
 * Not covered elsewhere: every published `askdb` pins its @askdb dependencies exactly,
 * so real `npm:` runs never reach the range path; and a real install failure can't be
 * produced on demand.
 * No production seam: the script runs as shipped, from a scratch copy of the lab. Only
 * the external tools are stand-ins: an `npm` on PATH that answers `npm view` from canned
 * manifests (listing matches out of order), and a `pnpm` that records the overrides it
 * was asked to install, then fails.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "lab-use-release-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const manifest = (name: string, version: string, dependencies = {}) => ({ name, version, dependencies });
/** `npm view <spec> --json` answers. A range answers with every match, deliberately unsorted. */
const REGISTRY: Record<string, unknown> = {
  "askdb@1.0.0": manifest("askdb", "1.0.0", { "@askdb/core": "^1.0.0-beta.2" }),
  "@askdb/core@^1.0.0-beta.2": [
    manifest("@askdb/core", "1.0.0-beta.9"),
    manifest("@askdb/core", "1.0.0-beta.10"),
    manifest("@askdb/core", "1.0.0-beta.2"),
  ],
};

const PKG = `${JSON.stringify({ name: "scratch-lab", private: true, dependencies: { askdb: "0.9.0", pg: "8.22.0" } }, null, 2)}\n`;
const LOCK = "lockfileVersion: '9.0'\n";
const TARGET = JSON.stringify({ label: "old target", source: "registry", packages: [] });

/**
 * A scratch lab (this `use.mjs`, the given pnpm-workspace.yaml) with the stand-in `npm`
 * and `pnpm` on PATH; runs `use.mjs npm:askdb@1.0.0` in it. `asked` is the workspace
 * file pnpm was asked to install, if it was asked at all.
 */
function switchScratchLab(name: string, ws: string) {
  const root = join(dir, name);
  const lab = join(root, "lab");
  const bin = join(root, "bin");
  const askedPath = join(root, "asked-to-install.yaml");
  mkdirSync(join(lab, "src"), { recursive: true });
  mkdirSync(join(lab, ".lab"));
  mkdirSync(bin);
  cpSync(join(LAB, "src", "use.mjs"), join(lab, "src", "use.mjs"));
  writeFileSync(join(lab, "package.json"), PKG);
  writeFileSync(join(lab, "pnpm-workspace.yaml"), ws);
  writeFileSync(join(lab, "pnpm-lock.yaml"), LOCK);
  writeFileSync(join(lab, ".lab", "target.json"), TARGET);

  writeFileSync(join(root, "registry.json"), JSON.stringify(REGISTRY));
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
const registry = require(${JSON.stringify(join(root, "registry.json"))});
const spec = process.argv[3];
if (!(spec in registry)) { console.error("npm error code E404"); process.exit(1); }
console.log(JSON.stringify(registry[spec]));
`,
  );
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.copyFileSync("pnpm-workspace.yaml", ${JSON.stringify(askedPath)});
process.exit(1);
`,
  );
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "pnpm"), 0o755);

  const run = spawnSync("node", [join(lab, "src", "use.mjs"), "npm:askdb@1.0.0"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return {
    lab,
    status: run.status,
    out: `${run.stdout}\n${run.stderr}`,
    asked: existsSync(askedPath) ? readFileSync(askedPath, "utf8") : undefined,
  };
}

it("pins a range to its highest semver match, and puts the manifests back when the install fails", () => {
  const ws = "allowBuilds:\n  esbuild: true\noverrides:\n  deepmerge-ts: ^8.0.2\n# lab:use overrides begin\n# lab:use overrides end\n";
  const { lab, status, out, asked } = switchScratchLab("install-fails", ws);

  expect(asked).toContain(`"@askdb/core": "1.0.0-beta.10"`);
  expect(asked).toContain(`"askdb": "1.0.0"`);
  // The pins land in the existing `overrides:` map, next to its hand-written third-party pins.
  expect(asked?.match(/^overrides:$/gm)).toHaveLength(1);
  expect(asked).toContain("  deepmerge-ts: ^8.0.2\n# lab:use overrides begin\n");

  expect(out).toContain("pnpm install failed for npm:askdb@1.0.0");
  expect(status).toBe(1);
  expect(readFileSync(join(lab, "package.json"), "utf8")).toBe(PKG);
  expect(readFileSync(join(lab, "pnpm-workspace.yaml"), "utf8")).toBe(ws);
  expect(existsSync(join(lab, ".lab", "target.json"))).toBe(false);
});

it.each([
  {
    problem: "a block outside the overrides: map",
    ws: "overrides:\n  deepmerge-ts: ^8.0.2\npackageExtensions: {}\n# lab:use overrides begin\n# lab:use overrides end\n",
    error: "pnpm-workspace.yaml's lab:use overrides block must sit inside its top-level `overrides:` map",
  },
  {
    problem: "no block",
    ws: "overrides:\n  deepmerge-ts: ^8.0.2\n",
    error: "pnpm-workspace.yaml has lost its lab:use overrides block",
  },
])("fails on $problem before changing anything", ({ problem, ws, error }) => {
  const { lab, status, out, asked } = switchScratchLab(problem.replace(/\W+/g, "-"), ws);

  expect(out).toContain(error);
  expect(status).toBe(1);
  expect(asked, "pnpm install never ran").toBeUndefined();
  expect(readFileSync(join(lab, "package.json"), "utf8")).toBe(PKG);
  expect(readFileSync(join(lab, "pnpm-workspace.yaml"), "utf8")).toBe(ws);
  expect(readFileSync(join(lab, "pnpm-lock.yaml"), "utf8")).toBe(LOCK);
  expect(readFileSync(join(lab, ".lab", "target.json"), "utf8")).toBe(TARGET);
});
