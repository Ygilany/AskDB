/**
 * `src/published-run.mjs`: the verdict, the drift report and the baseline check of the
 * `Consumer lab (published)` workflow, which runs the lab against AskDB as published on npm.
 *
 * Protects: (1) the verdict passes a run only when every failure is listed in
 * `known-release-failures.json` for the installed askdb version, with its issue; (2) a failing
 * test outside the matrix, a FAIL cell vitest counts as passing, and a run that left no
 * results each fail it; (3) after a release, a capability `n/a` cell fails it unless a
 * changeset was still pending at the released commit; (4) the fresh-install report lists every
 * package whose resolved versions moved; (5) the baseline check says the committed baseline is
 * stale, and which pins moved, when `lab:use` changed it.
 * Catches: an expectation applied to every release instead of the one it names (a bug fixed in
 * a release that then regresses would stay green), an untracked expectation, a tooling test
 * or an unhandled failure hidden behind an expected cell, a lab that never ran reading as a
 * pass, a release missing a capability reading as a pass, a lockfile parse that misses scoped
 * packages and reports no drift, and a stale baseline reported as current.
 * Not covered elsewhere: nothing else runs the script; the workflow only calls it. Its inputs
 * are written by the real matrix reporter and vitest's json reporter from probe tests
 * (`support/scratch-matrix.ts`), and the drift check reads the lab's committed lockfile, so
 * the script can't drift from the formats it reads.
 * No production seam: the script runs as shipped, copied into a scratch repo laid out like this
 * one (`examples/consumer-lab/`, `.changeset/`), where it finds its inputs at the paths the
 * workflow leaves them.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LAB, runMatrix } from "./support/scratch-matrix.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const EXPECTED = `describe("[postgres]", () => { it("probe-release-bug: fails on this release", () => { expect(1, "rows").toBe(2); }); });`;
const REST = `
describe("[mysql]", () => { it("probe-pass: passes", () => { expect(1).toBe(1); }); });
describe("[sqlite]", () => { it("probe-na: gated", (ctx) => { ctx.skip("capability: cap-a"); }); });
`;
const UNTRACKED = `
describe("lab tooling", () => { it("probe-tooling: fails outside the matrix", () => { expect(1).toBe(2); }); });
describe("[mariadb]", () => { it.fails("probe-unnamed: an expected failure with no issue", () => { expect(1).toBe(2); }); });
`;
const JSON_REPORT = ["--reporter=json", "--outputFile.json=.lab/vitest-results.json"];
const LISTED = { "askdb@1.0.0-beta.43": { "probe-release-bug [postgres]": "#403: fixed on main by #408" } };

/** A scratch repo holding the script, a matrix run's `.lab/` and the given lab files; `run` calls the script in it. */
function scratchRepo(matrixFile: string | undefined, opts: { askdb?: string; known?: unknown; changesets?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lab-published-"));
  dirs.push(root);
  const lab = join(root, "examples", "consumer-lab");
  mkdirSync(join(lab, "src"), { recursive: true });
  mkdirSync(join(lab, ".lab"));
  cpSync(join(LAB, "src", "published-run.mjs"), join(lab, "src", "published-run.mjs"));
  if (matrixFile) cpSync(dirname(matrixFile), join(lab, ".lab"), { recursive: true });
  const target = { label: "npm:latest", source: "registry", packages: [{ name: "askdb", version: opts.askdb ?? "1.0.0-beta.43" }] };
  writeFileSync(join(lab, ".lab", "target.json"), JSON.stringify(target));
  writeFileSync(join(lab, "known-release-failures.json"), JSON.stringify(opts.known ?? LISTED));
  mkdirSync(join(root, ".changeset"));
  for (const name of ["README.md", ...(opts.changesets ?? [])]) writeFileSync(join(root, ".changeset", name), "---\n---\n");
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [join(lab, "src", "published-run.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  return { root, lab, run };
}

describe("published-run verdict", () => {
  let expectedOnly: string;
  let withUntracked: string;
  beforeAll(() => {
    expectedOnly = runMatrix(`${EXPECTED}\n${REST}`, JSON_REPORT).file;
    withUntracked = runMatrix(`${EXPECTED}\n${REST}\n${UNTRACKED}`, JSON_REPORT).file;
  });

  it("passes a failure listed for the installed askdb version, and only for that version", () => {
    const listed = scratchRepo(expectedOnly).run("verdict");
    expect(listed.status, listed.out).toBe(0);
    expect(listed.out).toContain("| probe-release-bug [postgres] | #403: fixed on main by #408 |");

    const other = scratchRepo(expectedOnly, { askdb: "1.0.0-beta.44" }).run("verdict");
    expect(other.status, other.out).toBe(1);
    expect(other.out).toContain("- FAIL cell `probe-release-bug [postgres]`");
  });

  it("fails an expectation that names no issue", () => {
    const known = { "askdb@1.0.0-beta.43": { "probe-release-bug [postgres]": "fixed on main" } };
    const { status, out } = scratchRepo(expectedOnly, { known }).run("verdict");
    expect(status, out).toBe(1);
    expect(out).toContain("`probe-release-bug [postgres]` names no issue");
  });

  it("fails every failure the list doesn't name, beside an expected one: a test outside the matrix, and a FAIL cell vitest passes", () => {
    const { status, out } = scratchRepo(withUntracked).run("verdict");
    expect(status, out).toBe(1);
    const problems = out.split("\n").filter((l) => l.startsWith("- "));
    expect(problems).toEqual(["- FAIL cell `probe-unnamed [mariadb]`", expect.stringMatching(/^- failed test `lab tooling probe-tooling: fails outside the matrix` \(.*test\/probe\.test\.ts\)$/)]);
  });

  it("refuses a run that left no results instead of passing it", () => {
    const { status, out } = scratchRepo(undefined).run("verdict");
    expect(status, out).toBe(2);
    expect(out).toContain("matrix.json doesn't exist");
  });

  it("after a release, fails a capability n/a cell unless a changeset was still pending", () => {
    const none = scratchRepo(expectedOnly).run("verdict", "--after-release");
    expect(none.status, none.out).toBe(1);
    expect(none.out).toContain("- capability `n/a` after the release: `probe-na [sqlite]`");

    const pending = scratchRepo(expectedOnly, { changesets: ["some-fix.md"] }).run("verdict", "--after-release");
    expect(pending.status, pending.out).toBe(0);
    expect(pending.out).toContain("- `probe-na [sqlite]`: n/a (capability: cap-a)");
    expect(pending.out).toContain("`.changeset/some-fix.md`");
  });
});

describe("published-run drift", () => {
  it("lists every package whose resolved versions moved, scoped ones included", () => {
    const { lab, run } = scratchRepo(undefined);
    const lock = readFileSync(join(LAB, "pnpm-lock.yaml"), "utf8");
    writeFileSync(join(lab, "pnpm-lock.yaml"), lock);
    const pg = /^ {2}pg@([\d.]+):$/m.exec(lock)![1]!;
    const openai = /^ {2}'@ai-sdk\/openai@([\d.]+)':$/m.exec(lock)![1]!;
    const before = lock.replace(`\n  pg@${pg}:\n`, "\n  pg@0.0.1:\n").replace(`\n  '@ai-sdk/openai@${openai}':\n`, "\n  '@ai-sdk/openai@0.0.2':\n");
    writeFileSync(join(lab, "before.yaml"), before);

    const { status, out } = run("drift", join(lab, "before.yaml"));
    expect(status, out).toBe(0);
    expect(out).toContain("2 resolved differently");
    expect(out).toContain(`| pg | 0.0.1 | ${pg} |`);
    expect(out).toMatch(new RegExp(`\\| @ai-sdk/openai \\| (.+, )?0\\.0\\.2(, .+)? \\| (.+, )?${openai.replace(/\./g, "\\.")}(, .+)? \\|`));

    writeFileSync(join(lab, "before.yaml"), lock);
    expect(run("drift", join(lab, "before.yaml")).out).toContain("Each resolved to the version in `lab:use`'s lockfile.");
  });
});

describe("published-run baseline", () => {
  it("says the baseline is stale, and which pins moved, once lab:use changed it", () => {
    const { root, lab, run } = scratchRepo(undefined);
    // The lab's committed workspace file (not the working copy, which lab:use rewrites), so the
    // block is in the format lab:use writes.
    const committed = execFileSync("git", ["-C", LAB, "show", "HEAD:./pnpm-workspace.yaml"], { encoding: "utf8" });
    const askdb = /^ {2}"askdb": "([^"]+)"$/m.exec(committed)![1]!;
    for (const [file, text] of [["package.json", "{}\n"], ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"], ["pnpm-workspace.yaml", committed]]) writeFileSync(join(lab, file!), text!);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=lab", "-c", "user.email=lab@example.invalid", ...args]);
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "baseline");

    const current = run("baseline");
    expect(current.status, current.out).toBe(0);
    expect(current.out).toContain("Current: `pnpm lab:use npm:latest` changed none of the lab's");

    writeFileSync(join(lab, "pnpm-workspace.yaml"), committed.replace(`  "askdb": "${askdb}"`, '  "askdb": "9.9.9"'));
    const stale = run("baseline");
    expect(stale.status, stale.out).toBe(0);
    expect(stale.out).toContain("**Stale:** `pnpm lab:use npm:latest` changed `pnpm-workspace.yaml`");
    expect(stale.out).toContain(`| askdb | ${askdb} | 9.9.9 |`);
    expect(stale.out).not.toContain("@askdb/core |");
  });
});
