/**
 * `src/matrix-cells.mjs` lists every cell of a `matrix.json` that isn't `pass`, grouped by
 * `FAIL`, by issue and by capability.
 *
 * Protects: the consumer-lab skill's triage and baseline refresh
 * (`.agents/skills/consumer-lab/`), which account for each non-`pass` cell from this list, and
 * find the capability `n/a` cells a new release should have flipped.
 * Catches: a cell missing from the list (a dropped status, or a cell that names two
 * capabilities or issues listed under only one), a `pass` cell listed, `--status` not
 * filtering, or the reporter changing `matrix.json`'s shape so the list goes quietly empty,
 * which would read as "nothing to report".
 * Not covered elsewhere: `matrix-reporter.test.ts` checks what the reporter writes; nothing else
 * runs this script. The input is written by the real reporter, not by hand, so the two can't
 * drift apart unnoticed.
 * No production seam: the script takes a `matrix.json` path because the skill reads CI's
 * `consumer-lab-matrix` artifact with it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LAB, runMatrix } from "./support/scratch-matrix.js";

const PROBE = `
describe("[postgres]", () => { it("probe-pass: passes", () => { expect(1).toBe(1); }); });
describe("[mysql]", () => {
  it.fails("probe-known: one tracked bug (#1)", () => { expect(1).toBe(2); });
  it.fails("probe-known-two: two tracked bugs (#1) (#2)", () => { expect(1).toBe(2); });
});
describe("[sqlite]", () => { it("probe-na: gated", (ctx) => { ctx.skip("capability: cap-a"); }); });
describe("[mariadb]", () => {
  it("probe-na-two: gated on a", (ctx) => { ctx.skip("capability: cap-a"); });
  it("probe-na-two: gated on b", (ctx) => { ctx.skip("capability: cap-b"); });
});
describe("[sqlserver]", () => { it("probe-red: fails", () => { expect(41, "rows for agency 2").toBe(42); }); });
`;

/** Run the script on `file`; parse its groups into `{ "<group>: n cell(s)": [lines…] }`. */
function listCells(file: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [join(LAB, "src", "matrix-cells.mjs"), ...args, file], { encoding: "utf8" });
  const blocks = run.stdout.trim().split("\n\n").slice(1, -1);
  const groups = Object.fromEntries(blocks.map((b) => b.split("\n")).map(([head, ...lines]) => [head, lines.map((l) => l.trim())]));
  return { status: run.status, out: `${run.stdout}\n${run.stderr}`, groups, total: run.stdout.trim().split("\n").at(-1) };
}

describe("matrix-cells", () => {
  let matrix: ReturnType<typeof runMatrix>;
  beforeAll(() => {
    matrix = runMatrix(PROBE);
  });

  it("lists every cell that isn't pass, once per FAIL, issue and capability it names", () => {
    const { status, out, groups, total } = listCells(matrix.file);
    expect(status, out).toBe(0);
    expect(groups).toEqual({
      "FAIL: 1 cell(s)": ["probe-red [sqlserver]", "- [sqlserver] > probe-red: fails: AssertionError: rows for agency 2: expected 41 to be 42 // Object.is equality"],
      "known (#1): 2 cell(s)": ["probe-known [mysql]", "probe-known-two [mysql]"],
      "known (#2): 1 cell(s)": ["probe-known-two [mysql]"],
      "n/a (capability: cap-a): 2 cell(s)": ["probe-na [sqlite]", "probe-na-two [mariadb]"],
      "n/a (capability: cap-b): 1 cell(s)": ["probe-na-two [mariadb]"],
    });
    expect(total).toBe("5 cell(s) listed.");
  });

  it("keeps only the statuses --status names", () => {
    const { status, out, groups, total } = listCells(matrix.file, "--status", "na");
    expect(status, out).toBe(0);
    expect(Object.keys(groups)).toEqual(["n/a (capability: cap-a): 2 cell(s)", "n/a (capability: cap-b): 1 cell(s)"]);
    expect(total).toBe("2 cell(s) listed.");
  });

  it("refuses a file that isn't a matrix instead of listing nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lab-matrix-cells-"));
    try {
      const file = join(dir, "matrix.json");
      writeFileSync(file, JSON.stringify({ target: "npm:latest", results: [] }));
      const { status, out } = listCells(file);
      expect(status, out).toBe(2);
      expect(out).toContain("isn't a lab matrix");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
