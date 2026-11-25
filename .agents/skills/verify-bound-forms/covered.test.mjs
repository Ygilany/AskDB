// node --test .agents/skills/verify-bound-forms/covered.test.mjs   (CI's `bound-forms` job)
// The detector decides whether the deep run happens, so a path it misses is a check that never runs.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { classify, COVERED, listed, syncCommit } from "./covered.mjs";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");

test("COVERED is exactly the files in SKILL.md's coverage table", () => {
  const table = skill.slice(skill.indexOf("| File | What the check covers |"), skill.indexOf("Sync commit:"));
  const dirOf = (path) => path.slice(0, path.lastIndexOf("/") + 1);
  const files = [];
  for (const row of table.split("\n").filter((line) => line.startsWith("| `"))) {
    // A cell lists files as `dir/a.ts`, `b.ts`: a bare name sits beside the path before it.
    let dir = "";
    for (const [, name] of row.split("|")[1].matchAll(/`([^`]+)`/g)) {
      if (name.includes("/")) dir = dirOf(name);
      files.push(name.includes("/") ? name : dir + name);
    }
  }
  assert.deepEqual(files.sort(), [...COVERED].sort());
});

test("every file mutants.mjs breaks is covered", () => {
  const mutants = readFileSync(join(SKILL_DIR, "mutants.mjs"), "utf8");
  const files = [...mutants.matchAll(/^\s*file: "([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(files.length >= 6, "found the breaks");
  for (const file of files) assert.equal(classify(file), "covered", file);
});

test("classify: covered files, other sql source, the check, and everything else", () => {
  assert.equal(classify("packages/core/src/sql/bind.ts"), "covered");
  assert.equal(classify("packages/core/src/sql/tenant-placeholders.ts"), "covered");
  assert.equal(classify("packages/core/src/sql/validate.ts"), "sql");
  assert.equal(classify("packages/core/src/sql/dialects/mysql.ts"), "sql");
  assert.equal(classify("packages/core/src/sql/a-file-added-tomorrow.ts"), "sql");
  assert.equal(classify("packages/sqlite/src/verification/bound-forms-agree.test.ts"), "check");
  assert.equal(classify(".agents/skills/verify-bound-forms/mutants.mjs"), "check");
  assert.equal(classify(".agents/skills/verify-bound-forms/run.sh"), "check");
  // Not the check's subject: tests of the covered code, the skill's prose, other packages.
  assert.equal(classify("packages/core/src/sql/bind.test.ts"), null);
  assert.equal(classify(".agents/skills/verify-bound-forms/SKILL.md"), null);
  assert.equal(classify("packages/core/src/ask.ts"), null);
  assert.equal(classify("packages/core/src/sql/README.md"), null);
  assert.equal(classify("apps/cli/src/sql/bind.ts"), null);
});

test("listed: covered first, each path once", () => {
  assert.deepEqual(listed(["README.md", "packages/core/src/sql/zz.ts", "packages/core/src/sql/bind.ts", "packages/core/src/sql/bind.ts"]), [
    { class: "covered", path: "packages/core/src/sql/bind.ts" },
    { class: "sql", path: "packages/core/src/sql/zz.ts" },
  ]);
});

test("syncCommit reads SKILL.md's sync line, and this repo's SKILL.md has one", () => {
  assert.equal(syncCommit("text\n\nSync commit: `367219e8b6b1` (2026-11-18). More.\n"), "367219e8b6b1");
  assert.match(syncCommit(skill), /^[0-9a-f]{40}$/);
  assert.throws(() => syncCommit("no line here"));
});

// The CLI, in a scratch repo laid out like this one.
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "covered-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  for (const [key, value] of [["user.email", "t@example.com"], ["user.name", "T"], ["commit.gpgsign", "false"]]) git("config", key, value);
  const skillDir = ".agents/skills/verify-bound-forms";
  mkdirSync(join(root, skillDir), { recursive: true });
  cpSync(join(SKILL_DIR, "covered.mjs"), join(root, skillDir, "covered.mjs"));
  write("packages/core/src/sql/bind.ts", "export const a = 1;\n");
  write("packages/core/src/ask.ts", "export const b = 1;\n");
  write("README.md", "hi\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  write(`${skillDir}/SKILL.md`, `Sync commit: \`${git("rev-parse", "HEAD")}\` (today).\n`);
  git("add", ".");
  git("commit", "-q", "-m", "skill");
  git("checkout", "-q", "-b", "work");
  const run = (...args) => spawnSync("node", [join(root, skillDir, "covered.mjs"), ...args], { encoding: "utf8" });
  return { git, write, run };
}

test("exit 0 and no output when the branch changes nothing covered", (t) => {
  const { git, write, run } = scratch(t);
  write("packages/core/src/ask.ts", "export const b = 2;\n");
  write("README.md", "changed\n");
  git("commit", "-q", "-am", "elsewhere");
  const out = run("--base", "main");
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, "");
});

test("exit 3 for a committed change to covered code, and --diff prints it", (t) => {
  const { git, write, run } = scratch(t);
  write("packages/core/src/sql/bind.ts", "export const a = 2;\n");
  git("commit", "-q", "-am", "covered");
  const out = run("--base", "main", "--diff");
  assert.equal(out.status, 3);
  assert.match(out.stdout, /^covered packages\/core\/src\/sql\/bind\.ts\n/);
  assert.match(out.stdout, /\+export const a = 2;/);
});

test("exit 3 for an uncommitted edit, and for an untracked file under sql/", (t) => {
  const { write, run } = scratch(t);
  write("packages/core/src/sql/bind.ts", "export const a = 3;\n");
  assert.equal(run("--base", "main").status, 3);
  const { write: write2, run: run2 } = scratch(t);
  write2("packages/core/src/sql/new-renderer.ts", "export const c = 1;\n");
  const out = run2("--base", "main");
  assert.equal(out.status, 3);
  assert.equal(out.stdout, "sql packages/core/src/sql/new-renderer.ts\n");
});

test("--since-sync counts commits already on the base branch", (t) => {
  const { git, write, run } = scratch(t);
  git("checkout", "-q", "main");
  write("packages/core/src/sql/bind.ts", "export const a = 4;\n");
  git("commit", "-q", "-am", "landed on main after the sync commit");
  git("checkout", "-q", "work");
  git("merge", "-q", "main");
  assert.equal(run("--base", "main").status, 0);
  const out = run("--since-sync");
  assert.equal(out.status, 3);
  assert.equal(out.stdout, "covered packages/core/src/sql/bind.ts\n");
});

test("exit 1 for a base that does not resolve, and for an unknown argument", (t) => {
  const { run } = scratch(t);
  assert.equal(run("--base", "no-such-ref").status, 1);
  assert.equal(run("--bogus").status, 1);
  assert.equal(run("--base", "main", "--since-sync").status, 1);
});
