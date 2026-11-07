// Self-test for scripts/check-unpublished-versions.mjs: runs it on a throwaway git repo
// holding a pnpm workspace, with a `pr` branch off `main` and a fake `npm` first on PATH
// that knows which versions are "on npm". Run with `node --test` (CI's `preflight` job).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-unpublished-versions.mjs", import.meta.url));
// What `main` holds, and which of it is on npm.
const MAIN = { core: { version: "1.0.0" }, studio: { version: "0.2.0" }, docs: { version: "0.0.1", private: true } };
const ON_NPM = ["core@1.0.0", "studio@0.2.0"];
let bin;
let dir;

before(() => {
  bin = mkdtempSync(join(tmpdir(), "check-unpublished-versions-bin-"));
  const npm = join(bin, "npm");
  writeFileSync(
    npm,
    `#!/usr/bin/env node
const [cmd, spec] = process.argv.slice(2);
if (process.env.FAKE_NPM_DOWN) {
  process.stderr.write("npm error code ECONNREFUSED\\n");
  process.exit(1);
}
if (cmd === "view" && process.env.FAKE_NPM_PUBLISHED.split(",").includes(spec)) {
  process.stdout.write(JSON.stringify(spec.slice(spec.lastIndexOf("@") + 1)) + "\\n");
  process.exit(0);
}
process.stderr.write("npm error code E404\\nnpm error 404 No match found for version " + spec + "\\n");
process.exit(1);
`,
  );
  chmodSync(npm, 0o755);
});

after(() => rmSync(bin, { recursive: true, force: true }));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args) {
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd: dir, stdio: "pipe" },
  );
}

function write(path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function manifest(name, fields) {
  write(`pkgs/${name}/package.json`, { name, ...fields });
}

// `main` with one commit holding the packages, and a `pr` branch checked out from it.
function workspace(packages = MAIN) {
  dir = mkdtempSync(join(tmpdir(), "check-unpublished-versions-"));
  git("init", "-q", "-b", "main");
  write("pnpm-workspace.yaml", 'packages:\n  - "pkgs/*"\n');
  write("package.json", { name: "root", private: true });
  for (const [name, fields] of Object.entries(packages)) manifest(name, fields);
  git("add", "-A");
  git("commit", "-q", "-m", "main");
  git("checkout", "-q", "-b", "pr");
}

function pr(edit) {
  edit();
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "pr");
}

function run({ published = ON_NPM, npmDown = false } = {}) {
  return spawnSync("node", [SCRIPT, "--since", "main"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      FAKE_NPM_PUBLISHED: published.join(","),
      FAKE_NPM_DOWN: npmDown ? "1" : "",
    },
  });
}

function assertFails(result, id) {
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, new RegExp(`${id.replace(/[.@]/g, "\\$&")} isn't on npm`));
}

const fails = {
  "an unpublished version bump": [() => manifest("core", { version: "1.0.1" }), "core@1.0.1"],
  "a new public package": [() => manifest("fresh", { version: "0.1.0" }), "fresh@0.1.0"],
  "a private package made public": [() => manifest("docs", { version: "0.0.1" }), "docs@0.0.1"],
  "a bump written in package.yaml, which pnpm reads too": [
    () => {
      rmSync(join(dir, "pkgs/core/package.json"));
      write("pkgs/core/package.yaml", "name: core\nversion: 1.0.1\n");
    },
    "core@1.0.1",
  ],
  "a bump behind a symlinked manifest, which pnpm follows": [
    () => {
      write("shared/core.json", { name: "core", version: "1.0.1" });
      rmSync(join(dir, "pkgs/core/package.json"));
      symlinkSync("../../shared/core.json", join(dir, "pkgs/core/package.json"));
    },
    "core@1.0.1",
  ],
};

for (const [name, [edit, id]] of Object.entries(fails)) {
  test(`fails on ${name}`, () => {
    workspace();
    pr(edit);
    assertFails(run(), id);
  });
}

const passes = {
  "no manifest change": () => write("README.md", "docs\n"),
  "a private package's bump": () => manifest("docs", { version: "0.0.2", private: true }),
  "a dependency-only change": () => manifest("core", { version: "1.0.0", dependencies: { other: "^2.0.0" } }),
  "a deleted package": () => rmSync(join(dir, "pkgs/studio"), { recursive: true }),
  "a change to the private root manifest": () => write("package.json", { name: "root", private: true, scripts: { x: "true" } }),
};

for (const [name, edit] of Object.entries(passes)) {
  test(`passes ${name}`, () => {
    workspace();
    pr(edit);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
  });
}

test("passes a new version that is already on npm, after looking it up", () => {
  workspace();
  pr(() => manifest("core", { version: "0.9.0" }));
  const result = run({ published: [...ON_NPM, "core@0.9.0"] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /core@0\.9\.0: new since the merge base, already on npm/);
});

test("passes an unpublished version that came in with the merge base, not this PR", () => {
  // A merged Version PR whose publish hasn't run yet leaves core@2.0.0 on `main`.
  workspace({ ...MAIN, core: { version: "2.0.0" } });
  pr(() => write("README.md", "docs\n"));
  assert.equal(run().status, 0);
});

test("fails closed when npm can't be reached", () => {
  workspace();
  pr(() => manifest("core", { version: "1.0.1" }));
  const result = run({ npmDown: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm view core@1\.0\.1 failed/);
});

test("fails without --since", () => {
  workspace();
  const result = spawnSync("node", [SCRIPT], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 2);
});
