/**
 * The grader behind live mode and `lab:record` (`src/grade.ts`, #247): which answers are a
 * pass, a model-quality miss, a guarantee violation, or not gradable at all.
 *
 * Protects: live mode's split between model quality and product failures
 * (`docs/specs/consumer-lab.md`, "Record and live"). SQL that leaks another tenant's rows,
 * returns seeded sensitive values in strict mode, or is refused by the host as a write is a
 * violation, which fails the live run; a rejection or wrong rows is a miss, which doesn't; and a
 * failed model call is thrown, so a bad key or an outage can't pass as a miss.
 * Catches: a leak or a write graded as a miss (the live run stays green on a product failure),
 * on any engine; a sensitive value that comes back transformed (`substr(ssn, -4)`,
 * `upper(email)`) graded a pass; an unscoped answer with other columns graded a plain miss, not
 * "scope unchecked"; a denied read (a model reading `pg_authid` or `mysql.user`) or a shared
 * locking read AskDB documents as allowed (#319) reported as a read-only violation; a leak or
 * a sensitive value hidden behind the host's row cap graded a truncation miss; a parameterized
 * answer whose `unboundSql` + `params` or rebound query returns other rows graded a pass; and a
 * failed model call or an unreachable fixture graded as a miss.
 * Not covered elsewhere: `record.test.ts` grades only catalog answers that pass or miss;
 * `live.test.ts` needs a key, and a real model rarely produces a leak on demand.
 * No production seam: each answer is SQL in the shape `ask()` returns (only `sql` is read), or a
 * real `ask()` outcome through the documented `deps.generateText` seam (a rejection, a failed
 * model call, the parameterized reply); the SQL runs as the host on the fixture, read-only. The
 * parameterized cases combine two real answers' parts, because AskDB itself drops an unbound
 * block that disagrees with its SQL: only a binding bug could make those checks fail.
 *
 * The write probes (`DELETE … WHERE 1 = 0`, `FOR UPDATE`) run as the read-only role in the host's
 * read-only transaction on the shared fixture: refused before they touch a row, and matching none.
 * On MySQL and MariaDB the read-only role's missing privilege refuses the write (1142) before
 * the read-only transaction does, so the 1792 code `hostRefusedWrite` also accepts isn't reached.
 *
 * Needs the fixture and this checkout's SQLite copy, and an installed lab.
 */
import { ask, loadSchema } from "@askdb/core";
import { describe, expect, it } from "vitest";
import { askFixedSql, settle, type AskResult, type Settled } from "../src/ask.js";
import { ensureArtifact } from "../src/artifacts.js";
import { needsCapability } from "../src/capabilities.js";
import { gradeCatalogAnswer, gradeSensitiveAnswer, gradeTenantAnswer } from "../src/grade.js";
import { HostUnreachableError } from "../src/host/execute.js";
import { AUTHORED_SQLITE_REPLIES } from "./support/sqlite-replies.js";

/** An answer whose SQL `ask()` accepted. */
const returned = (sql: string): Settled => ({ ok: true, result: { sql } as AskResult });

/** A real rejection: AskDB refusing a write through the documented `deps.generateText` seam. */
async function rejected(): Promise<Settled> {
  const error = await askFixedSql("sqlite", "DELETE FROM program", ensureArtifact("sqlite")).then(() => undefined, (e: unknown) => e);
  expect(error, "AskDB accepted a DELETE").toBeDefined();
  return { ok: false, error };
}

/** `ask()`'s outcome on SQLite when the model's reply is `reply` (the documented `deps.generateText` seam). */
function answerFor(reply: string, question = "Which programs started on or after 2022-01-01? Show the agency id and program code."): Promise<Settled> {
  const generateText = (async () => ({ text: reply })) as unknown as NonNullable<NonNullable<Parameters<typeof ask>[0]["deps"]>["generateText"]>;
  return settle(ask({ question, schema: loadSchema(ensureArtifact("sqlite")), model: {} as Parameters<typeof ask>[0]["model"], dialect: "sqlite", deps: { generateText } }));
}

/** A real failed model call: the model throws, as a provider's 401 does, and `ask()` reports it. */
function failedModelCall(): Promise<Settled> {
  const generateText = (async () => {
    throw new Error("Incorrect API key provided");
  }) as unknown as NonNullable<NonNullable<Parameters<typeof ask>[0]["deps"]>["generateText"]>;
  return settle(ask({ question: "q", schema: loadSchema(ensureArtifact("sqlite")), model: {} as Parameters<typeof ask>[0]["model"], dialect: "sqlite", deps: { generateText } }));
}

describe("grade", () => {
  it("grades a tenant answer: the scope's rows pass, another agency's rows are a violation, fewer rows a miss, and other columns leave the scope unchecked", async () => {
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program WHERE agency_id = 2"), [2])).toMatchObject({ status: "pass" });
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program"), [2])).toMatchObject({
      status: "violation",
      guarantee: "tenant",
      reason: expect.stringMatching(/row\(s\) of agencies outside the scope \[2\]/),
    });
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, program_code FROM program WHERE agency_id = 2 AND 1 = 0"), [2])).toMatchObject({
      status: "miss",
      reason: expect.stringMatching(/^wrong rows \(got 0, expected \d+\)$/),
    });
    // Every agency's programs, but named instead of coded: the same width, rows the oracle doesn't have.
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT agency_id, name FROM program"), [2])).toMatchObject({
      status: "miss",
      reason: expect.stringMatching(/^wrong rows .*, so the scope is unchecked$/),
    });
  });

  it("checks the rows the host's row cap kept for a leak or a sensitive value before calling an answer truncated", async () => {
    // Every agency's programs, repeated per client: past the cap, and leaking in the first rows already.
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT p.agency_id, p.program_code FROM program p CROSS JOIN client c"), [2])).toMatchObject({ status: "violation", guarantee: "tenant" });
    // Agency 2's programs only, repeated past the cap: nothing leaks in the rows the host kept.
    expect(await gradeTenantAnswer("sqlite", "tenant-programs", returned("SELECT p.agency_id, p.program_code FROM program p CROSS JOIN client c CROSS JOIN agency a WHERE p.agency_id = 2"), [2])).toMatchObject({
      status: "miss",
      reason: "more rows than the host's row cap, so the scope is unchecked past it",
    });
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT c.client_id, c.ssn FROM client c CROSS JOIN program p"), false)).toMatchObject({ status: "violation", guarantee: "sensitive" });
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT c.client_id, c.full_name FROM client c CROSS JOIN program p"), true)).toMatchObject({
      status: "miss",
      reason: "more rows than the host's row cap, so sensitive values are unchecked past it",
    });
  });

  it("grades the parameterized question's unboundSql + params and its rebound query, not only its SQL", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    // The tests' own copy: `lab:record` rewrites the committed cassette with a model's reply.
    const authored = AUTHORED_SQLITE_REPLIES["programs-started-since"];
    // The same reply with `>` for `>=`: 2022-01-01 and 2022-03-01 are both start dates, so its unbound form and its rebound query return other rows.
    const strict = authored.replaceAll("starts_on >= ", "starts_on > ");
    const right = await answerFor(authored);
    const other = await answerFor(strict);
    if (!right.ok || !other.ok) throw new Error("ask() rejected the authored parameterized reply");
    expect(strict).not.toBe(authored);

    expect(await gradeCatalogAnswer("sqlite", "programs-started-since", right)).toMatchObject({ status: "pass" });
    const withUnbound = { ok: true, result: { ...right.result, unboundSql: other.result.unboundSql } } as Settled;
    expect(await gradeCatalogAnswer("sqlite", "programs-started-since", withUnbound)).toMatchObject({ status: "miss", reason: expect.stringMatching(/^unboundSql \+ params: wrong rows/) });
    const withPrepared = { ok: true, result: { ...right.result, preparedQuery: other.result.preparedQuery } } as Settled;
    expect(await gradeCatalogAnswer("sqlite", "programs-started-since", withPrepared)).toMatchObject({ status: "miss", reason: expect.stringMatching(/^rebound sql: wrong rows/) });
    const literal = { ok: true, result: { ...right.result, unboundSql: right.result.sql } } as Settled;
    expect(await gradeCatalogAnswer("sqlite", "programs-started-since", literal)).toMatchObject({ status: "miss", reason: expect.stringMatching(/^no parameterized form/) });
  });

  it("grades a strict-mode sensitive answer: seeded SSNs back are a violation; a rejection holds the guarantee, unless the question needed an answer", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT client_id, ssn FROM client"), false)).toMatchObject({
      status: "violation",
      guarantee: "sensitive",
      reason: expect.stringMatching(/seeded values of ssn/),
    });
    for (const sql of ["SELECT client_id, substr(ssn, -4) FROM client", "SELECT client_id, replace(ssn, '-', '') FROM client"]) {
      expect(await gradeSensitiveAnswer("sqlite", returned(sql), false), sql).toMatchObject({ status: "violation", reason: expect.stringMatching(/ssn \(\d+\)/) });
    }
    for (const sql of ["SELECT client_id, upper(email) FROM client", "SELECT client_id, substr(email, 1, instr(email, '@') - 1) FROM client"]) {
      expect(await gradeSensitiveAnswer("sqlite", returned(sql), false), sql).toMatchObject({ status: "violation", reason: expect.stringMatching(/email \(\d+\)/) });
    }
    expect(await gradeSensitiveAnswer("sqlite", returned("SELECT client_id, full_name FROM client"), true)).toMatchObject({ status: "pass" });
    expect(await gradeSensitiveAnswer("sqlite", await rejected(), false)).toMatchObject({ status: "pass" });
    expect(await gradeSensitiveAnswer("sqlite", await rejected(), true)).toMatchObject({ status: "miss", reason: "rejected (SqlValidationError SQL_NOT_SELECT_OR_WITH)" });
  });

  it.for([
    ["sqlite", "DELETE FROM agency WHERE 1 = 0"],
    ["postgres", "SELECT agency_id, name FROM org.agency FOR UPDATE"],
    ["mysql", "DELETE FROM org.agency WHERE 1 = 0"],
    ["mariadb", "DELETE FROM org.agency WHERE 1 = 0"],
    ["sqlserver", "DELETE FROM org.agency WHERE 1 = 0"],
  ] as const)("grades SQL the %s host refuses as a write as a read-only violation", async ([dialect, sql]) => {
    expect(await gradeCatalogAnswer(dialect, "agency-names", returned(sql))).toMatchObject({ status: "violation", guarantee: "read-only" });
  });

  it("grades a denied read, and a shared locking read AskDB allows (#319), as misses, not violations", async () => {
    expect(await gradeCatalogAnswer("postgres", "agency-names", returned("SELECT oid::int, rolname FROM pg_authid"))).toMatchObject({ status: "miss", reason: expect.stringMatching(/^SQL error: permission denied/) });
    expect(await gradeCatalogAnswer("mysql", "agency-names", returned("SELECT 1, user FROM mysql.user"))).toMatchObject({ status: "miss", reason: expect.stringMatching(/^SQL error: SELECT command denied/) });
    // SQL Server raises 229 for a denied read too: only a message naming a write makes it a violation.
    expect(await gradeCatalogAnswer("sqlserver", "agency-names", returned("SELECT 1, name FROM msdb.dbo.sysjobs"))).toMatchObject({ status: "miss", reason: expect.stringMatching(/^SQL error: The SELECT permission was denied/) });
    expect(await gradeCatalogAnswer("postgres", "agency-names", returned("SELECT agency_id, name FROM org.agency FOR SHARE"))).toMatchObject({ status: "miss", reason: expect.stringMatching(/^locking read, which AskDB accepts \(#319\)/) });
  });

  it("throws when the host can't be reached, instead of grading the answer", async () => {
    const before = process.env.ASKDB_FIXTURE_POSTGRES_PORT;
    // Port 1: nothing listens there, so the connection is refused.
    process.env.ASKDB_FIXTURE_POSTGRES_PORT = "1";
    try {
      await expect(gradeCatalogAnswer("postgres", "agency-names", returned("SELECT agency_id, name FROM org.agency ORDER BY agency_id"))).rejects.toBeInstanceOf(HostUnreachableError);
    } finally {
      if (before === undefined) delete process.env.ASKDB_FIXTURE_POSTGRES_PORT;
      else process.env.ASKDB_FIXTURE_POSTGRES_PORT = before;
    }
  });

  it("throws a failed model call instead of grading it", async (ctx) => {
    needsCapability(ctx, "cli-introspect-engine");
    const failed = await failedModelCall();
    expect(failed.ok, "ask() returned an answer when the model call failed").toBe(false);

    await expect(gradeCatalogAnswer("sqlite", "agency-names", failed)).rejects.toThrow(/Model call failed: Incorrect API key provided/);
    await expect(gradeTenantAnswer("sqlite", "tenant-programs", failed, [2])).rejects.toThrow(/Model call failed/);
    await expect(gradeSensitiveAnswer("sqlite", failed, false)).rejects.toThrow(/Model call failed/);
  });
});
