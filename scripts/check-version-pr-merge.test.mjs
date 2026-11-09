// Self-test for scripts/check-version-pr-merge.mjs: runs it in a throwaway git repo holding
// a pnpm workspace (the merge's first parent, then the merge), with a fake `gh` first on
// PATH that answers only the merge commit's PR endpoint, with the PR list each test gives.
// Run with `node --test` (CI's `preflight` job).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-version-pr-merge.mjs", import.meta.url));
const REPO = "owner/repo";
// What the merge's Version PR bumped, and so what `publish` would ship.
const BUMPED = [{ name: "core", version: "1.0.1" }];
let bin;
let dir;
let merge;

before(() => {
  bin = mkdtempSync(join(tmpdir(), "check-version-pr-merge-bin-"));
  const gh = join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env node
const [cmd, path] = process.argv.slice(2);
if (process.env.FAKE_GH_FAIL) {
  process.stderr.write("gh: Resource not accessible by integration (HTTP 403)\\n");
  process.exit(1);
}
if (cmd !== "api" || (path !== process.env.FAKE_GH_ENDPOINT && !path.startsWith(process.env.FAKE_GH_ENDPOINT + "?"))) {
  process.stderr.write("gh: Not Found (HTTP 404)\\n");
  process.exit(1);
}
process.stdout.write(process.env.FAKE_GH_PULLS);
`,
  );
  chmodSync(gh, 0o755);
});

after(() => rmSync(bin, { recursive: true, force: true }));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args) {
  return execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd: dir, encoding: "utf8" },
  ).trim();
}

function write(path, value) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
}

// The first parent holds the packages before the merge; the merge bumps core to 1.0.1.
function workspace(beforeMerge = { core: "1.0.0" }) {
  dir = mkdtempSync(join(tmpdir(), "check-version-pr-merge-"));
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "pkgs/*"\n');
  write("package.json", { name: "root", private: true });
  for (const [name, version] of Object.entries(beforeMerge)) write(`pkgs/${name}/package.json`, { name, version });
  git("add", "-A");
  git("commit", "-q", "-m", "main before the merge");
  write("pkgs/core/package.json", { name: "core", version: "1.0.1" });
  git("add", "-A");
  git("commit", "-q", "-m", "merge the Version PR");
  merge = git("rev-parse", "HEAD");
}

function versionPr(fields = {}) {
  return {
    number: 7,
    merged_at: "2026-11-07T00:00:00Z",
    merge_commit_sha: merge,
    base: { ref: "main" },
    head: { ref: "changeset-release/main", repo: { full_name: REPO } },
    ...fields,
  };
}

function run(pulls, { packages = BUMPED, sha = merge, fail = false } = {}) {
  return spawnSync("node", [SCRIPT, sha], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: REPO,
      PACKAGES: packages === null ? "" : JSON.stringify(packages),
      FAKE_GH_ENDPOINT: `repos/${REPO}/commits/${sha}/pulls`,
      FAKE_GH_PULLS: JSON.stringify(pulls),
      FAKE_GH_FAIL: fail ? "1" : "",
    },
  });
}

test("passes the merge commit of a merged Version PR that added every version, among the commit's other PRs", () => {
  workspace();
  const other = versionPr({ number: 3, head: { ref: "feat/x", repo: { full_name: REPO } } });
  const result = run([other, versionPr()]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /merge commit of Version PR #7/);
});

test("refuses a version that was already unpublished on main before the Version PR merged", () => {
  // An earlier Version PR's studio@0.2.1 never published, and this merge doesn't touch it.
  workspace({ core: "1.0.0", studio: "0.2.1" });
  const result = run([versionPr()], { packages: [...BUMPED, { name: "studio", version: "0.2.1" }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Version PR #7 didn't add studio@0\.2\.1/);
  // The hand publish it prints is filtered to the merge's own versions, so studio stays out.
  assert.match(result.stderr, /publish this merge's own versions \(core@1\.0\.1\)/);
  assert.match(result.stderr, /--filter "core" publish/);
  assert.doesNotMatch(result.stderr, /--filter "studio/);
});

const refused = {
  "a commit that merged another PR": () => [versionPr({ head: { ref: "feat/x", repo: { full_name: REPO } } })],
  "a Version PR that isn't merged": () => [versionPr({ merged_at: null })],
  "the Version PR's head commit, not its merge commit": () => [versionPr({ merge_commit_sha: "4".repeat(40) })],
  "a changeset-release/main branch from a fork": () => [
    versionPr({ head: { ref: "changeset-release/main", repo: { full_name: "fork/repo" } } }),
  ],
  "a deleted head repository": () => [versionPr({ head: { ref: "changeset-release/main", repo: null } })],
  "a Version PR merged into another branch": () => [versionPr({ base: { ref: "release" } })],
  "a commit GitHub lists no PR for (a direct push)": () => [],
};

for (const [name, pulls] of Object.entries(refused)) {
  test(`refuses ${name}`, () => {
    workspace();
    const result = run(pulls());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /isn't the merge commit of a merged Version PR/);
  });
}

test("fails when gh can't read the commit's PRs", () => {
  workspace();
  const result = run([versionPr()], { fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read the PRs/);
});

test("rejects a sha that isn't 40 hex characters, or a PACKAGES list it can't check", () => {
  workspace();
  assert.equal(run([versionPr()], { sha: "main" }).status, 2);
  assert.equal(run([versionPr()], { packages: null }).status, 2);
  // An entry without a string name and version can't be checked, so it isn't let through.
  assert.equal(run([versionPr()], { packages: ["core@1.0.1"] }).status, 2);
  assert.equal(run([versionPr()], { packages: [{ name: "core" }] }).status, 2);
});
