/**
 * `pnpm lab ask --db <dialect> --sql …`: fixed SQL through AskDB, end to end, on every engine.
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
 * Needs the `cli-introspect-engine` capability: a target whose `askdb introspect --help`
 * doesn't list `--engine` reports `n/a (capability: cli-introspect-engine)` instead of
 * failing. A CLI that can't print help at all (missing, crashing, or unable to read the
 * lab's config, as the May 2026 `0.5.0-beta` CLI does, #267) fails.
 *
 * Needs the fixture (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`). It
 * fails, rather than skips, when either is missing.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";

const LAB = fileURLToPath(new URL("..", import.meta.url));

/** `org.agency` everywhere except SQLite, whose single namespace holds the table unqualified. */
function agencyTable(dialect: SupportedDialect): string {
  return dialect === "sqlite" ? "agency" : "org.agency";
}

function labAsk(dialect: SupportedDialect, sql: string) {
  const run = spawnSync("pnpm", ["--silent", "lab", "ask", "--db", dialect, "--sql", sql], {
    cwd: LAB,
    encoding: "utf8",
  });
  return { status: run.status, out: `${run.stdout}\n${run.stderr}` };
}

describe.each(SUPPORTED_DIALECTS.map((d) => [d] as [SupportedDialect]))("[%s] lab-ask --sql", (dialect) => {
  it("prints the SQL, `validation: ok` and the rows the read-only role reads", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const sql = `SELECT agency_id, name FROM ${agencyTable(dialect)} ORDER BY agency_id`;
    const { status, out } = labAsk(dialect, sql);

    expect(out).toContain(sql);
    expect(out).toContain("validation: ok");
    expect(out).toContain("東京オフィス");
    expect(out).toMatch(/7 rows/);
    expect(status).toBe(0);
  });

  it("reports a rejected statement's error class and rule code, and prints no rows", (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const { status, out } = labAsk(dialect, `DELETE FROM ${agencyTable(dialect)}`);

    expect(out).toMatch(/validation: rejected/);
    expect(out).toContain("SqlValidationError");
    expect(out).toContain("SQL_NOT_SELECT_OR_WITH");
    expect(out).not.toMatch(/\d+ rows?/);
    expect(status).toBe(1);
  });
});
