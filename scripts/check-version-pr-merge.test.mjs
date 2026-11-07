// Self-test for scripts/check-version-pr-merge.mjs: runs it with a fake `gh` first on PATH
// that answers only the commit's PR endpoint, with the PR list each test gives. Run with
// `node --test` (CI's `preflight` job).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-version-pr-merge.mjs", import.meta.url));
const SHA = "3".repeat(40);
const REPO = "owner/repo";
let bin;

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
if (cmd !== "api" || !path.startsWith(process.env.FAKE_GH_ENDPOINT + "?") && path !== process.env.FAKE_GH_ENDPOINT) {
  process.stderr.write("gh: Not Found (HTTP 404)\\n");
  process.exit(1);
}
process.stdout.write(process.env.FAKE_GH_PULLS);
`,
  );
  chmodSync(gh, 0o755);
});

after(() => rmSync(bin, { recursive: true, force: true }));

function versionPr(fields = {}) {
  return {
    number: 7,
    merged_at: "2026-11-07T00:00:00Z",
    merge_commit_sha: SHA,
    base: { ref: "main" },
    head: { ref: "changeset-release/main", repo: { full_name: REPO } },
    ...fields,
  };
}

function run(pulls, { sha = SHA, fail = false } = {}) {
  return spawnSync("node", [SCRIPT, sha], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      GITHUB_REPOSITORY: REPO,
      FAKE_GH_ENDPOINT: `repos/${REPO}/commits/${sha}/pulls`,
      FAKE_GH_PULLS: JSON.stringify(pulls),
      FAKE_GH_FAIL: fail ? "1" : "",
    },
  });
}

test("passes the merge commit of a merged Version PR, among the commit's other PRs", () => {
  const other = versionPr({ number: 3, head: { ref: "feat/x", repo: { full_name: REPO } } });
  const result = run([other, versionPr()]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /merge commit of Version PR #7/);
});

const refused = {
  "a commit that merged another PR": [versionPr({ head: { ref: "feat/x", repo: { full_name: REPO } } })],
  "a Version PR that isn't merged": [versionPr({ merged_at: null })],
  "the Version PR's head commit, not its merge commit": [versionPr({ merge_commit_sha: "4".repeat(40) })],
  "a changeset-release/main branch from a fork": [
    versionPr({ head: { ref: "changeset-release/main", repo: { full_name: "fork/repo" } } }),
  ],
  "a deleted head repository": [versionPr({ head: { ref: "changeset-release/main", repo: null } })],
  "a Version PR merged into another branch": [versionPr({ base: { ref: "release" } })],
  "a commit GitHub lists no PR for (a direct push)": [],
};

for (const [name, pulls] of Object.entries(refused)) {
  test(`refuses ${name}`, () => {
    const result = run(pulls);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /isn't the merge commit of a merged Version PR/);
  });
}

test("fails when gh can't read the commit's PRs", () => {
  const result = run([versionPr()], { fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read the PRs/);
});

test("rejects a sha that isn't 40 hex characters", () => {
  assert.equal(run([versionPr()], { sha: "main" }).status, 2);
});
