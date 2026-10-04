/**
 * The grader behind live mode and `lab:record` (`src/grade.ts`, #247): which answers are a
 * pass, a model-quality miss, a guarantee violation, or not gradable at all.
 *
 * Protects: live mode's split between model quality and product failures
 * (`docs/specs/consumer-lab.md`, "Record and live"). SQL that leaks another tenant's rows,
 * returns seeded sensitive values in strict mode, or is refused by the host as a write is a
 * violation, which fails the live run; a rejection or wrong rows is a miss, which doesn't; and a
 * failed model call is thrown, so a bad key or an outage can't pass as a miss.
 * Catches: a leak or a write graded as a miss (the live run stays green on a product failure); a
 * denied read (a model reading `pg_authid`) reported as a read-only violation; a provider failure,
 * which AskDB wraps as `SqlGenerationError`, graded as a miss.
 * Not covered elsewhere: `record.test.ts` grades only catalog answers that pass or miss;
 * `live.test.ts` needs a key, and a real model rarely produces a leak on demand.
 * No production seam: each answer is SQL in the shape `ask()` returns (only `sql` is read), or an
 * error AskDB documents and exports; the SQL runs as the host on the fixture, read-only.
 *
 * Needs the fixture's Postgres and this checkout's SQLite copy, and an installed lab.
 */
import { SqlGenerationError } from "@askdb/core";
import { describe, expect, it } from "vitest";
import { askFixedSql, type AskResult, type Settled } from "../src/ask.js";
import { ensureArtifact } from "../src/artifacts.js";
import { needsCapability } from "../src/capabilities.js";
import { gradeCatalogAnswer, gradeSensitiveAnswer, gradeTenantAnswer } from "../src/grade.js";

/** An answer whose SQL `ask()` accepted. */
const returned = (sql: string): Settled => ({ ok: true, result: { sql } as AskResult });

/** A real rejection: AskDB refusing a write through the documented `deps.generateText` seam. */
async function rejected(): Promise<Settled> {
  const error = await askFixedSql("sqlite", "DELETE FROM program", ensureArtifact("sqlite")).then(() => undefined, (e: unknown) => e);
  expect(error, "AskDB accepted a DELETE").toBeDefined();
  return { ok: false, error };
}

describe("grade", () => {
  it("grades a tenant answer: the scope's rows pass, another agency's rows are a violation, fewer rows a miss", async () => {
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program WHERE agency_id = 2"), [2])).toMatchObject({ status: "pass" });
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program"), [2])).toMatchObject({
      status: "violation",
      guarantee: "tenant",
      reason: expect.stringMatching(/row\(s\) of agencies outside the scope \[2\]/),
    });
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program WHERE agency_id = 2 AND 1 = 0"), [2])).toMatchObject({
      status: "miss",
      reason: expect.stringMatching(/^wrong rows/),
    });
  });

  it("grades a strict-mode sensitive answer: seeded SSNs back are a violation; a rejection holds the guarantee, unless the question needed an answer", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT client_id, ssn FROM client"), false)).toMatchObject({
      status: "violation",
      guarantee: "sensitive",
      reason: expect.stringMatching(/seeded values of ssn/),
    });
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT client_id, full_name FROM client"), true)).toMatchObject({ status: "pass" });
    expect(await gradeSensitiveAnswer("sqlite", await rejected(), false)).toMatchObject({ status: "pass" });
    expect(await gradeSensitiveAnswer("sqlite", await rejected(), true)).toMatchObject({ status: "miss", reason: "rejected (SqlValidationError SQL_NOT_SELECT_OR_WITH)" });
  });

  it("grades SQL the host refuses as a write as a read-only violation, and a denied read as a miss", async () => {
    expect(await gradeCatalogAnswer("sqlite", "agency-names", returned("DELETE FROM agency WHERE 1 = 0"))).toMatchObject({ status: "violation", guarantee: "read-only" });
    expect(await gradeCatalogAnswer("postgres", "agency-names", returned("SELECT agency_id, name FROM org.agency FOR UPDATE"))).toMatchObject({ status: "violation", guarantee: "read-only" });
    expect(await gradeCatalogAnswer("postgres", "agency-names", returned("SELECT oid::int, rolname FROM pg_authid"))).toMatchObject({ status: "miss", reason: expect.stringMatching(/^SQL error: permission denied/) });
  });

  it("throws a failed model call instead of grading it", async () => {
    const failed: Settled = { ok: false, error: new SqlGenerationError("Model call failed: Incorrect API key provided", new Error("401")) };

    await expect(gradeCatalogAnswer("sqlite", "agency-names", failed)).rejects.toBeInstanceOf(SqlGenerationError);
    await expect(gradeTenantAnswer("sqlite", "tenant-programs", failed, [2])).rejects.toBeInstanceOf(SqlGenerationError);
    await expect(gradeSensitiveAnswer("sqlite", failed, false)).rejects.toBeInstanceOf(SqlGenerationError);
  });
});
