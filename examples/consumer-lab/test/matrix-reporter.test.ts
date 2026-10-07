/**
 * `pnpm lab:matrix` exits non-zero exactly when the matrix has a `FAIL` cell.
 *
 * Protects: the CI gate. The consumer-lab job in `.github/workflows/ci.yml` passes or fails on
 * the matrix command's exit code, and the README promises it fails on any `FAIL` cell and
 * passes on `pass`, `n/a`, `known` and `miss` (a live-model miss, `LAB_LIVE_MODEL=1`, #247).
 * Catches: a `FAIL` cell that vitest itself counts as passing, so CI stays green. Two exist: an
 * `it.fails` test that names no issue (vitest: "expected fail"), and a skip whose note isn't a
 * capability gate (vitest: "skipped"). Also catches the opposite regression: a `known (#N)` or
 * `n/a (capability: …)` cell failing the run, and the summary losing the failing cells or the
 * reason each one failed (the assertion message, or the rule that made it a failure).
 * Not covered elsewhere: no other test runs the reporter; the lab's real scenarios all pass.
 * No production seam: each case is a real vitest run of the lab's reporter in a scratch root
 * (`test/support/scratch-matrix.ts`), so the lab's own `.lab/matrix.json` isn't touched.
 */
import { describe, expect, it } from "vitest";
import { runMatrix } from "./support/scratch-matrix.js";

/** Run `body` (a test file's describe blocks) under the matrix reporter in a scratch lab. */
function matrix(body: string) {
  const { status, out, json, summary } = runMatrix(body);
  const failures = Object.fromEntries(
    json.rows.flatMap((r) => Object.entries(r.cells).flatMap(([d, c]) => (c.failures ? [[`${r.scenario} [${d}]`, c.failures]] : []))),
  );
  const cells = Object.fromEntries(json.rows.flatMap((r) => Object.entries(r.cells).map(([d, c]) => [`${r.scenario} [${d}]`, c.text])));
  return { status, out, cells, failures, summary };
}

const GREEN = `
describe("[postgres]", () => { it("probe-pass: passes", () => { expect(1).toBe(1); }); });
describe("[mysql]", () => { it.fails("probe-known: a tracked bug (#1)", () => { expect(1).toBe(2); }); it.fails("probe-known: the same bug and another (#1) (#2)", () => { expect(1).toBe(2); }); });
describe("[sqlite]", () => { it("probe-na: gated", (ctx) => { ctx.skip("capability: probe-capability"); }); });
`;

describe("lab:matrix exit code", () => {
  it("passes a run whose cells are only pass, known and n/a", () => {
    const { status, out, cells, summary } = matrix(GREEN);
    expect(cells).toEqual({
      "probe-pass [postgres]": "pass",
      "probe-known [mysql]": "known (#1, #2)",
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

  it.each([
    ["a failing test", `it("probe-red: fails", () => { expect(41, "rows for <agency 2>").toBe(42); });`, "rows for &lt;agency 2&gt;: expected 41 to be 42"],
    ["an expected failure that names no issue", `it.fails("probe-red: untracked", () => { expect(1).toBe(2); });`, "names no issue"],
    ["a skip that isn't a capability gate", `it("probe-red: skipped", (ctx) => { ctx.skip("the fixture is down"); });`, "the fixture is down"],
  ])("says why a cell failed from %s, in the summary and in matrix.json", (_what, test, reason) => {
    const { failures, summary } = matrix(`${GREEN}\ndescribe("[mariadb]", () => { ${test} });`);
    const [failure] = failures["probe-red [mariadb]"] ?? [];
    expect(failure?.test).toMatch(/^\[mariadb\] > probe-red: /);
    expect(failure?.reason.replace(/</g, "&lt;").replace(/>/g, "&gt;")).toContain(reason);
    expect(summary).toContain("#### Why they failed");
    expect(summary).toContain(`<summary><code>probe-red [mariadb]</code>: ${failure?.test.replace(/>/g, "&gt;")}</summary>`);
    expect(summary).toContain(reason);
    expect(summary).not.toContain("\u001b[");
  });

  // Live-model mode (test/live.test.ts, #247). Contract: a test annotated `miss` reads
  // `miss (<reasons>)` and doesn't fail the run (model quality), but a failing test beside it
  // (a guarantee violation) still makes the cell FAIL. Catches: misses read as `pass` (the live
  // run hides what the model got wrong), or failing the run (every live run red). No other test
  // runs the reporter on annotations; no production seam (a real vitest run in a scratch lab).
  it("passes a run whose live-model misses read miss (…), and still fails a FAIL cell next to a miss", () => {
    const misses = `
describe("[postgres]", () => {
  it("probe-miss: raw", (ctx) => { ctx.annotate("raw: wrong rows", "miss"); });
  it("probe-miss: client", (ctx) => { ctx.annotate("client: rejected (SqlValidationError SQL_MULTI_STATEMENT)", "miss"); });
  it("probe-miss-pass: raw", () => { expect(1).toBe(1); });
  it("probe-miss-pass: client", (ctx) => { ctx.annotate("client: wrong columns", "miss"); });
});`;
    const green = matrix(`${GREEN}\n${misses}`);
    expect(green.cells["probe-miss [postgres]"]).toBe("miss (raw: wrong rows; client: rejected (SqlValidationError SQL_MULTI_STATEMENT))");
    expect(green.cells["probe-miss-pass [postgres]"]).toBe("miss (client: wrong columns)");
    expect(green.status, green.out).toBe(0);

    const red = matrix(`${GREEN}\n${misses}\ndescribe("[postgres]", () => { it("probe-miss: violation", () => { expect("leaked", "a guarantee violation").toBe("held"); }); });`);
    expect(red.cells["probe-miss [postgres]"]).toBe("FAIL");
    expect(red.status, red.out).toBe(1);
  });

  it("gives no reasons when nothing failed", () => {
    const { failures, summary } = matrix(GREEN);
    expect(failures).toEqual({});
    expect(summary).not.toContain("Why they failed");
  });
});
