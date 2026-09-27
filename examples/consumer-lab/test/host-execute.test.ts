/**
 * The lab's host execution on every engine: the row cap and the statement timeout that
 * `guides/run-safely-in-prod` asks a host to apply.
 *
 * Protects: on each of the five engines, a result longer than the cap comes back cut to
 * the cap, flagged `truncated`, and in the statement's own ORDER BY; a statement that
 * runs past the timeout is stopped and reported as `StatementTimeoutError`.
 * Catches: a cap that silently reorders rows (the checklist's LIMIT wrapper does, on
 * MariaDB: #266), a cap that isn't applied or doesn't report truncation, and a timeout
 * that never fires, so a runaway statement would hang every later lab suite.
 * Not covered elsewhere: AskDB never executes SQL, so no package test owns this; the
 * fixture's own tests read rows back but apply no cap or timeout.
 * No production seam: `executeReadOnly` is the lab's own host code, called directly.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { describe, expect, it } from "vitest";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { loadRows, physicalName } from "../src/fixture.js";
import { StatementTimeoutError, executeReadOnly } from "../src/host/execute.js";

const ORDER_LINE = { schema: "billing", name: "order_line" };

/** The five order lines with the highest (order_id, line_no), highest first, from the dataset files. */
const expectedTopLines = loadRows(ORDER_LINE)
  .map((r) => [Number(r.order_id), Number(r.line_no)])
  .sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]!);

/** About 10^9 rows to count: longer than any timeout here, on every engine. */
function runawayCount(): string {
  const digits = "(SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
  return `SELECT COUNT(*) AS n FROM ${Array.from({ length: 9 }, (_, i) => `${digits} AS t${i}`).join(" CROSS JOIN ")}`;
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] host-execute", (dialect) => {
  it("caps rows at the limit, flags truncation and keeps the statement's order", async () => {
    const sql = `SELECT order_id, line_no FROM ${physicalName(dialect, ORDER_LINE)} ORDER BY order_id DESC, line_no DESC`;

    const capped = await executeReadOnly(dialect, sql, { rowCap: 5 });
    const whole = await executeReadOnly(dialect, sql, { rowCap: 1000 });

    expect(capped.columns).toEqual(["order_id", "line_no"]);
    expect(capped.rows.map((r) => r.map(Number))).toEqual(expectedTopLines.slice(0, 5));
    expect(capped.truncated).toBe(true);
    expect(whole.rows).toHaveLength(expectedTopLines.length + (dialect === "sqlite" ? 1 : 0)); // TEMP break (#254 proof)
    expect(whole.truncated).toBe(false);
  });

  it("executes a statement that ends with a semicolon, which AskDB's output may", async () => {
    // The NL→SQL prompt allows an optional trailing semicolon; a wrapper around the
    // statement (the Postgres row cap) must not turn it into a syntax error.
    const sql = `SELECT order_id FROM ${physicalName(dialect, ORDER_LINE)} ORDER BY order_id DESC, line_no DESC;`;
    const result = await executeReadOnly(dialect, sql, { rowCap: 1 });
    expect(result.rows.map((r) => Number(r[0]))).toEqual([expectedTopLines[0]![0]]);
  });

  it("stops a statement that runs past the timeout", async () => {
    const started = Date.now();

    await expect(executeReadOnly(dialect, runawayCount(), { statementTimeoutMs: 500 })).rejects.toBeInstanceOf(StatementTimeoutError);
    // Well under the ~9 s the runaway count takes when nothing stops it.
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 30_000);
});
