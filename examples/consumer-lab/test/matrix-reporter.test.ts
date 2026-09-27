/**
 * `pnpm lab:matrix` exits non-zero exactly when the matrix has a `FAIL` cell.
 *
 * Protects: the CI gate. The consumer-lab job in `.github/workflows/ci.yml` passes or fails on
 * the matrix command's exit code, and the README promises it fails on any `FAIL` cell and
 * passes on `pass`, `n/a` and `known`.
 * Catches: a `FAIL` cell that vitest itself counts as passing, so CI stays green. Two exist: an
 * `it.fails` test that names no issue (vitest: "expected fail"), and a skip whose note isn't a
 * capability gate (vitest: "skipped"). Also catches the opposite regression: a `known (#N)` or
 * `n/a (capability: …)` cell failing the run, and the summary losing the failing cells.
 * Not covered elsewhere: no other test runs the reporter; the lab's real scenarios all pass.
 * No production seam: each case is a real vitest run with the lab's `src/matrix-reporter.ts`,
 * `src/paths.ts` and `src/fixture.ts` (copied verbatim, the last with its fixture path made
 * absolute) in a scratch root, so the lab's own `.lab/matrix.json` isn't touched.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE_INDEX = fileURLToPath(new URL("../../../fixtures/multi-engine/src/index.js", import.meta.url));
const scratch: string[] = [];
afterAll(() => scratch.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Run `body` (a test file's describe blocks) under the matrix reporter in a scratch lab. */
function matrix(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "lab-matrix-"));
  scratch.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "test"));
  for (const file of ["matrix-reporter.ts", "paths.ts"]) cpSync(join(LAB, "src", file), join(dir, "src", file));
  const fixture = readFileSync(join(LAB, "src", "fixture.ts"), "utf8").replace("../../../fixtures/multi-engine/src/index.js", FIXTURE_INDEX);
  writeFileSync(join(dir, "src", "fixture.ts"), fixture);
  symlinkSync(join(LAB, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "test", "probe.test.ts"), `import { describe, expect, it } from "vitest";\n${body}\n`);
  const summary = join(dir, "summary.md");
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
  const run = spawnSync(
    process.execPath,
    [join(LAB, "node_modules", "vitest", "vitest.mjs"), "run", "--root", dir, "--reporter=default", "--reporter=./src/matrix-reporter.ts"],
    { cwd: dir, encoding: "utf8", env },
  );
  const json = JSON.parse(readFileSync(join(dir, ".lab", "matrix.json"), "utf8")) as {
    rows: { scenario: string; cells: Record<string, { text: string }> }[];
  };
  const cells = Object.fromEntries(json.rows.flatMap((r) => Object.entries(r.cells).map(([d, c]) => [`${r.scenario} [${d}]`, c.text])));
  return { status: run.status, out: `${run.stdout}\n${run.stderr}`, cells, summary: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
}

const GREEN = `
describe("[postgres]", () => { it("probe-pass: passes", () => { expect(1).toBe(1); }); });
describe("[mysql]", () => { it.fails("probe-known: a tracked bug (#1)", () => { expect(1).toBe(2); }); });
describe("[sqlite]", () => { it("probe-na: gated", (ctx) => { ctx.skip("capability: probe-capability"); }); });
`;

describe("lab:matrix exit code", () => {
  it("passes a run whose cells are only pass, known and n/a", () => {
    const { status, out, cells, summary } = matrix(GREEN);
    expect(cells).toEqual({
      "probe-pass [postgres]": "pass",
      "probe-known [mysql]": "known (#1)",
      "probe-na [sqlite]": "n/a (capability: probe-capability)",
    });
    expect(summary).toContain("### Consumer lab matrix");
    expect(summary).not.toContain("FAIL");
    expect(status, out).toBe(0);
  });

  it.each([
    ["an expected failure that names no issue", `it.fails("probe-red: untracked", () => { expect(1).toBe(2); });`],
    ["a skip that isn't a capability gate", `it("probe-red: skipped", (ctx) => { ctx.skip("the fixture is down"); });`],
    ["a failing test", `it("probe-red: fails", () => { expect(1).toBe(2); });`],
  ])("fails a run with one FAIL cell from %s, and names it in the summary", (_what, test) => {
    const { status, out, cells, summary } = matrix(`${GREEN}\ndescribe("[mariadb]", () => { ${test} });`);
    expect(cells["probe-red [mariadb]"]).toBe("FAIL");
    expect(cells["probe-pass [postgres]"]).toBe("pass");
    expect(summary).toContain("1 FAIL cell(s):** probe-red [mariadb]");
    expect(status, out).toBe(1);
  });
});
