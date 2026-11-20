#!/usr/bin/env node
// Does a change touch what the bound-forms check covers?
//   node .agents/skills/verify-bound-forms/covered.mjs                # this branch against origin/main, plus uncommitted and untracked files
//   node .agents/skills/verify-bound-forms/covered.mjs --base <ref>   # against another base
//   node .agents/skills/verify-bound-forms/covered.mjs --since-sync   # everything since the sync commit in SKILL.md
//   ... --diff                                                        # also print the diff of the files listed
//
// Prints one line per file that matters, `<class> <path>`:
//   covered  a file in SKILL.md's coverage table
//   sql      any other source file under packages/core/src/sql/. The check may not cover it yet:
//            if it writes params, tenantParams, bindings[].indices or the text that replaces a
//            placeholder, add it to the coverage table and to COVERED below
//   check    the check itself: the property test, run.sh, mutants.mjs, this script
//
// exit 0  nothing listed: the change doesn't touch it
// exit 3  at least one file listed: do the deep run and the mutants (SKILL.md, section 2)
// exit 1  bad arguments, or git failed
//
// It errs towards exit 3: a path filter can't see what a hunk does, so every source file under
// packages/core/src/sql/ counts. Code elsewhere that writes params is still yours to notice.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));

/** The files in SKILL.md's coverage table. `covered.test.mjs` fails when the two differ. */
export const COVERED = ["rebind", "checked-statement", "bind", "tenant-placeholders", "lexer", "readings"].map((name) => `packages/core/src/sql/${name}.ts`);
const SQL_DIR = "packages/core/src/sql/";
const CHECK = ["packages/sqlite/src/verification/", ".agents/skills/verify-bound-forms/"];
const isTest = (path) => /\.(test|spec)\.[cm]?tsx?$/.test(path) || path.includes("/__tests__/") || path.includes("/__snapshots__/");

/** @param {string} path repo-relative @returns {"covered" | "sql" | "check" | null} */
export function classify(path) {
  if (COVERED.includes(path)) return "covered";
  if (CHECK.some((prefix) => path.startsWith(prefix))) return path.endsWith(".md") ? null : "check";
  if (path.startsWith(SQL_DIR) && /\.[cm]?tsx?$/.test(path) && !isTest(path)) return "sql";
  return null;
}

/** @param {string[]} paths @returns {{ class: "covered" | "sql" | "check", path: string }[]} */
export function listed(paths) {
  const order = { covered: 0, sql: 1, check: 2 };
  return [...new Set(paths)]
    .flatMap((path) => {
      const cls = classify(path);
      return cls ? [{ class: cls, path }] : [];
    })
    .sort((a, b) => order[a.class] - order[b.class] || a.path.localeCompare(b.path));
}

/** The sync commit SKILL.md records. */
export function syncCommit(skillText) {
  const sha = /^Sync commit: `([0-9a-f]{7,40})`/m.exec(skillText)?.[1];
  if (!sha) throw new Error("SKILL.md has no line starting: Sync commit: `<sha>`");
  return sha;
}

function main() {
  const fail = (message) => {
    console.error(`covered: ${message}`);
    process.exit(1);
  };
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const sinceSync = take("--since-sync");
  const showDiff = take("--diff");
  let base = "origin/main";
  const baseAt = args.indexOf("--base");
  if (baseAt !== -1) {
    if (sinceSync) fail("pass --base or --since-sync, not both");
    [, base] = args.splice(baseAt, 2);
    if (!base) fail("--base needs a ref");
  }
  if (args.length) fail(`unknown argument ${args[0]}`);

  const git = (...a) => {
    try {
      return execFileSync("git", a, { cwd: SKILL_DIR, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      return fail(`git ${a.join(" ")} failed: ${String(/** @type {{ stderr?: string }} */ (error).stderr ?? error).trim()}`);
    }
  };
  const root = git("rev-parse", "--show-toplevel").trim();
  // Since the sync commit: every commit after it. Against a base: what this branch adds to it.
  const from = sinceSync ? syncCommit(readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8")) : git("merge-base", base, "HEAD").trim();
  const lines = (text) => text.split("\n").filter(Boolean);
  // `git diff <from>` compares the commit with the working tree, so uncommitted edits count.
  const paths = [...lines(git("-C", root, "diff", "--name-only", from)), ...lines(git("-C", root, "ls-files", "--others", "--exclude-standard"))];
  const found = listed(paths);
  for (const entry of found) console.log(`${entry.class} ${entry.path}`);
  if (showDiff && found.length) process.stdout.write(git("-C", root, "diff", from, "--", ...found.map((entry) => entry.path)));
  process.exit(found.length ? 3 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
