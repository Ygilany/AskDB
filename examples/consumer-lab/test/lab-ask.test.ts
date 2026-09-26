/**
 * `pnpm lab ask --db postgres --sql …`: the lab's tracer bullet, end to end.
 *
 * Protects: the lab's host path through AskDB as installed from the install
 * target's tarballs. Fixed SQL goes through the public `ask()` (via the documented
 * `deps.generateText` seam), and its validation outcome is reported. Accepted SQL is
 * executed on the multi-engine fixture as the read-only role and its rows printed.
 * Rejected SQL reports the error class and rule code, and is never executed.
 * Catches: a packed `@askdb/core` whose validation no longer rejects (or no longer
 * accepts) what the docs say, rows that don't come back from the fixture, or the lab
 * executing SQL that AskDB rejected.
 * Not covered elsewhere: core's validator unit tests import workspace source, and the
 * installable smoke test never calls `ask()` on a database. This is the first test that
 * runs packed AskDB against a real engine.
 * No production seam: `deps.generateText` is documented in the core API reference.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). It
 * fails, rather than skips, when either is missing.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LAB = fileURLToPath(new URL("..", import.meta.url));

function labAsk(sql: string) {
  const run = spawnSync("pnpm", ["--silent", "lab", "ask", "--db", "postgres", "--sql", sql], {
    cwd: LAB,
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

describe("[postgres] lab-ask --sql", () => {
  it("prints the SQL, `validation: ok` and the rows the read-only role reads", () => {
    const { status, out } = labAsk("SELECT agency_id, name FROM org.agency ORDER BY agency_id");

    expect(out).toContain("SELECT agency_id, name FROM org.agency ORDER BY agency_id");
    expect(out).toContain("validation: ok");
    expect(out).toContain("東京オフィス");
    expect(out).toMatch(/7 rows/);
    expect(status).toBe(0);
  });

  it("reports a rejected statement's error class and rule code, and prints no rows", () => {
    const { status, out } = labAsk("DELETE FROM org.agency");

    expect(out).toMatch(/validation: rejected/);
    expect(out).toContain("SqlValidationError");
    expect(out).toContain("SQL_NOT_SELECT_OR_WITH");
    expect(out).not.toMatch(/\d+ rows?/);
    expect(status).toBe(1);
  });
});
