// Self-test for scripts/prerelease-counter.mjs: runs it against a throwaway pnpm workspace
// and reads the package.json files it leaves. Run with `node --test` (CI's `preflight` job).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

const SCRIPT = new URL("./prerelease-counter.mjs", import.meta.url).pathname;
let dir;

// One workspace package per entry: `{ name: { version, private? } }`.
function workspace(pre, packages) {
  dir = mkdtempSync(join(tmpdir(), "prerelease-counter-"));
  writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "pkgs/*"\n');
  writeFileSync(join(dir, "package.json"), '{ "name": "root", "private": true }\n');
  mkdirSync(join(dir, ".changeset"));
  if (pre) writeFileSync(join(dir, ".changeset", "pre.json"), JSON.stringify(pre));
  for (const [name, fields] of Object.entries(packages)) {
    mkdirSync(join(dir, "pkgs", name), { recursive: true });
    const manifest = { name, ...fields, dependencies: { other: `${fields.version}` } };
    writeFileSync(join(dir, "pkgs", name, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

function run(command) {
  return spawnSync("node", [SCRIPT, command], { cwd: dir, encoding: "utf8" });
}

function manifest(name) {
  return JSON.parse(readFileSync(join(dir, "pkgs", name, "package.json"), "utf8"));
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("reset restarts the counter of public packages on another prerelease line", () => {
  workspace({ mode: "pre", tag: "rc" }, {
    core: { version: "1.0.0-beta.46" },
    studio: { version: "0.2.0-beta.39" },
    onTag: { version: "1.0.0-rc.3" },
    released: { version: "1.2.0" },
    docs: { version: "0.0.1-beta.9", private: true },
  });

  assert.equal(run("reset").status, 0);

  assert.equal(manifest("core").version, "1.0.0-beta.0");
  assert.equal(manifest("studio").version, "0.2.0-beta.0");
  // Already on the rc line: restarting it would renumber versions npm already has.
  assert.equal(manifest("onTag").version, "1.0.0-rc.3");
  assert.equal(manifest("released").version, "1.2.0");
  assert.equal(manifest("docs").version, "0.0.1-beta.9");
  // Only the version field changes, not a dependency range that spells the same string.
  assert.equal(manifest("core").dependencies.other, "1.0.0-beta.46");
});

test("check fails naming each public package left on another prerelease line", () => {
  workspace({ mode: "pre", tag: "rc" }, {
    core: { version: "1.0.0-rc.1" },
    studio: { version: "0.2.0-beta.0" },
    released: { version: "1.2.0" },
    docs: { version: "0.0.1-beta.9", private: true },
  });

  const result = run("check");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /studio@0\.2\.0-beta\.0/);
  assert.doesNotMatch(result.stderr, /core@|released@|docs@/);
});

test("check passes once every public prerelease is on the pre tag", () => {
  workspace({ mode: "pre", tag: "rc" }, {
    core: { version: "1.0.0-rc.1" },
    released: { version: "1.2.0" },
    docs: { version: "0.0.1-beta.9", private: true },
  });

  assert.equal(run("check").status, 0);
});

test("both commands do nothing outside pre mode", () => {
  for (const pre of [{ mode: "exit", tag: "rc" }, undefined]) {
    workspace(pre, { core: { version: "1.0.0-beta.46" } });

    assert.equal(run("reset").status, 0);
    assert.equal(manifest("core").version, "1.0.0-beta.46");
    assert.equal(run("check").status, 0);

    rmSync(dir, { recursive: true, force: true });
  }
});
