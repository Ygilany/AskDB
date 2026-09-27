/**
 * `pnpm lab:use npm:askdb@<version>`: resolving a release's dependency tree, and a failed
 * install.
 *
 * Protects: (1) a dependency range in a published manifest resolves to the highest
 * matching version by semver, so prereleases like `1.0.0-beta.10` sort above
 * `1.0.0-beta.9`, whatever order `npm view` lists them in; (2) when `pnpm install` fails
 * after the manifests were rewritten, they are put back as they were and the lab is
 * marked not installed (no `.lab/target.json`), instead of left half-switched.
 * Catches: a lexical or npm-order pick of a range (pinning beta.9 over beta.10), and a
 * failed switch that leaves `file:` or registry pins behind while the lab still claims
 * the old target.
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

it("pins a range to its highest semver match, and puts the manifests back when the install fails", () => {
  const lab = join(dir, "lab");
  const bin = join(dir, "bin");
  mkdirSync(join(lab, "src"), { recursive: true });
  mkdirSync(join(lab, ".lab"));
  mkdirSync(bin);
  cpSync(join(LAB, "src", "use.mjs"), join(lab, "src", "use.mjs"));
  const pkg = `${JSON.stringify({ name: "scratch-lab", private: true, dependencies: { pg: "8.22.0" } }, null, 2)}\n`;
  const ws = "allowBuilds:\n  esbuild: true\n# lab:use overrides begin\n# lab:use overrides end\n";
  writeFileSync(join(lab, "package.json"), pkg);
  writeFileSync(join(lab, "pnpm-workspace.yaml"), ws);
  writeFileSync(join(lab, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(lab, ".lab", "target.json"), JSON.stringify({ label: "old target", source: "registry", packages: [] }));

  writeFileSync(join(dir, "registry.json"), JSON.stringify(REGISTRY));
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
const registry = require(${JSON.stringify(join(dir, "registry.json"))});
const spec = process.argv[3];
if (!(spec in registry)) { console.error("npm error code E404"); process.exit(1); }
console.log(JSON.stringify(registry[spec]));
`,
  );
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.copyFileSync("pnpm-workspace.yaml", ${JSON.stringify(join(dir, "asked-to-install.yaml"))});
process.exit(1);
`,
  );
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "pnpm"), 0o755);

  const run = spawnSync("node", [join(lab, "src", "use.mjs"), "npm:askdb@1.0.0"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const out = `${run.stdout}\n${run.stderr}`;

  const asked = readFileSync(join(dir, "asked-to-install.yaml"), "utf8");
  expect(asked).toContain(`"@askdb/core": "1.0.0-beta.10"`);
  expect(asked).toContain(`"askdb": "1.0.0"`);

  expect(out).toContain("pnpm install failed for npm:askdb@1.0.0");
  expect(run.status).toBe(1);
  expect(readFileSync(join(lab, "package.json"), "utf8")).toBe(pkg);
  expect(readFileSync(join(lab, "pnpm-workspace.yaml"), "utf8")).toBe(ws);
  expect(existsSync(join(lab, ".lab", "target.json"))).toBe(false);
});
