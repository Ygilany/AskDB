/**
 * Safety: adversarial model replies, rejected by the installed `ask()` on every engine, and
 * proven meaningful on a scratch copy of the fixture.
 *
 * Protects: the read-only SQL guardrail as the docs state it. `concepts/safety-boundaries.mdx`
 * ("What AskDB enforces": read-only, single statement, no system schemas) and
 * `getting-started/troubleshooting.mdx` (each rule code: `SQL_NOT_SELECT_OR_WITH`,
 * `SQL_MULTI_STATEMENT`, `SQL_COMMENT`, `SQL_FORBIDDEN_KEYWORD` for `INTO`, `DELETE`, `EXEC`,
 * `WAITFOR` …, `SQL_FORBIDDEN_FUNCTION` for `pg_sleep`, `LOAD_FILE`, `SLEEP` …; keywords match
 * only as whole unquoted tokens, "so a column like `deleted_at` or `"delete"` is fine"). Each
 * case is a model reply, delivered through the documented `deps.generateText` seam, and must
 * be rejected with `SqlValidationError` and the rule code the docs and the dialect's
 * `extraForbiddenKeywords` / `blockedFunctions` give for it, not just any error. Two quoting
 * cases must be *accepted*, returned unchanged, and run as the read-only role: the validator
 * must not over-reject a keyword inside a quoted identifier or a string literal.
 * The write-class cases are also proven meaningful: the same statement, run as the engine's
 * owner on a scratch copy of the fixture (`src/scratch.ts`), really changes observable state
 * (a row count, a dropped or altered table, a new table, a row lock another connection
 * can't get). The file, OS, server-control and sleep cases are rejection-only: they are
 * never executed, on any database, and cite the rule instead.
 * Catches: a packed `@askdb/core` whose validator lets a write, DDL, a second statement, a
 * data-modifying CTE, `SELECT … INTO`, a locking read, a comment or a side-effecting call
 * through on some engine; one that rejects it under a different rule than documented (a
 * negative control passing for an unrelated reason); one that over-rejects quoted keywords;
 * and a case that has quietly become harmless on an engine, so its rejection proves nothing.
 * Not covered elsewhere: core's validator unit tests run workspace source against strings
 * and never touch an engine, so they can't show a statement does damage, or that the packed
 * build rejects it; `lab-ask` checks only that one DELETE is reported as rejected.
 * No production seam: `ask()` with `deps.generateText` (documented in `reference/core-api.mdx`),
 * `SqlValidationError` and its `rule` (documented error class). The scratch copies are lab
 * code and are only ever written by the owner, never through AskDB.
 *
 * Engine-inapplicable syntax is not generated for that engine (no `TRUNCATE` on SQLite, no
 * `SELECT … INTO` outside Postgres and SQL Server, no `FOR UPDATE` on SQLite or SQL Server).
 *
 * Known discrepancies, marked `it.fails`: queries on system schemas pass validation on
 * every engine although `safety-boundaries.mdx` says they are rejected (#318); SQL
 * Server's `WITH (UPDLOCK)` locking read passes while `FOR UPDATE` is rejected elsewhere
 * (#319). Its scratch proof still runs: the lock is real.
 *
 * Needs the `cli-introspect-engine` capability to build the schema artifacts, the fixture
 * (`pnpm fixture:up`) and an installed lab (`pnpm lab:use .`).
 */
import { SqlValidationError } from "@askdb/core";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { askFixedSql } from "../src/ask.js";
import { ensureArtifact, requireInstallTarget } from "../src/artifacts.js";
import { hasCapability, needsCapability } from "../src/capabilities.js";
import { SUPPORTED_DIALECTS, type SupportedDialect } from "../src/dialects.js";
import { loadRows, physicalName } from "../src/fixture.js";
import { executeReadOnly } from "../src/host/execute.js";
import { createScratch, type ScratchConnection, type ScratchDb } from "../src/scratch.js";

type Rule = SqlValidationError["rule"];
/** A logical table's physical name: the fixture's (for `ask()`) or a scratch copy's (for the proof). */
type Name = (schema: string, table: string) => string;

interface Case {
  /** The matrix row. */
  scenario: string;
  /** What the reply does, for the test name. */
  what: string;
  dialects: readonly SupportedDialect[];
  sql: (t: Name, dialect: SupportedDialect) => string;
  /** The documented outcome: rejected with this rule code. */
  rule: Rule;
  /** Set when the installed `ask()` doesn't match the docs: the discrepancy issue. */
  known?: number;
  /** Run the same statement as the owner on a scratch copy and assert what it did. */
  proof?: (run: ProofContext) => Promise<void>;
}

interface ProofContext {
  dialect: SupportedDialect;
  scratch: ScratchDb;
  /** The case's SQL, with the scratch copy's names. */
  statement: string;
  t: Name;
}

const ALL = SUPPORTED_DIALECTS;
const SERVERS = ALL.filter((d) => d !== "sqlite");
const MYSQL_FAMILY = ["mysql", "mariadb"] as const satisfies readonly SupportedDialect[];

const ORDER_LINES = loadRows({ schema: "billing", name: "order_line" });
const STATUSES = loadRows({ schema: "ref", name: "status" });

// --- Proof helpers: each observes state on the scratch copy before and after the statement ---

async function withOwner<T>(scratch: ScratchDb, fn: (c: ScratchConnection) => Promise<T>): Promise<T> {
  const c = await scratch.connect();
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

async function scalar(c: ScratchConnection, sql: string): Promise<number> {
  const [row] = await c.rows(sql);
  return Number(Object.values(row ?? {})[0]);
}

/** Runs the statement and returns `observe`'s value before and after it. */
async function beforeAfter<T>(p: ProofContext, observe: (c: ScratchConnection) => Promise<T>): Promise<{ before: T; after: T }> {
  return withOwner(p.scratch, async (c) => {
    const before = await observe(c);
    await c.run(p.statement);
    return { before, after: await observe(c) };
  });
}

const lineCount = (p: ProofContext) => (c: ScratchConnection) => scalar(c, `SELECT COUNT(*) AS n FROM ${p.t("billing", "order_line")}`);

/** The statement empties `billing.order_line`, which holds every seeded line beforehand. */
async function emptiesOrderLines(p: ProofContext): Promise<void> {
  expect(await beforeAfter(p, lineCount(p))).toEqual({ before: ORDER_LINES.length, after: 0 });
}

/** `sql` fails with an error that names `missing`, a table or column that doesn't exist (yet, or any more). */
async function failsNaming(c: ScratchConnection, sql: string, missing: string): Promise<void> {
  await expect(c.rows(sql)).rejects.toThrow(new RegExp(missing, "i"));
}

/**
 * Lock proof: a holder runs the statement inside a transaction; a second owner connection
 * that asks for the same row lock with a short lock timeout fails with the engine's
 * lock-timeout error, and gets it once the holder rolls back.
 */
const LOCKING: Partial<Record<SupportedDialect, { begin: string; rollback: string; shortWait: string; lockTimeout: object }>> = {
  postgres: { begin: "BEGIN", rollback: "ROLLBACK", shortWait: "SET lock_timeout = '1s'", lockTimeout: { code: "55P03" } },
  mysql: { begin: "START TRANSACTION", rollback: "ROLLBACK", shortWait: "SET SESSION innodb_lock_wait_timeout = 1", lockTimeout: { errno: 1205 } },
  mariadb: { begin: "START TRANSACTION", rollback: "ROLLBACK", shortWait: "SET SESSION innodb_lock_wait_timeout = 1", lockTimeout: { errno: 1205 } },
  sqlserver: { begin: "BEGIN TRANSACTION", rollback: "ROLLBACK TRANSACTION", shortWait: "SET LOCK_TIMEOUT 1000", lockTimeout: { number: 1222 } },
};

async function holdsRowLock(p: ProofContext): Promise<void> {
  const tx = LOCKING[p.dialect]!;
  const locked = ORDER_LINES.filter((l) => l.order_id === 1).length;
  const holder = await p.scratch.connect();
  const waiter = await p.scratch.connect();
  try {
    await holder.run(tx.begin);
    expect(await holder.rows(p.statement)).toHaveLength(locked);
    await waiter.run(tx.shortWait);
    await expect(waiter.rows(p.statement)).rejects.toMatchObject(tx.lockTimeout);
    await holder.run(tx.rollback);
    expect(await waiter.rows(p.statement)).toHaveLength(locked);
  } finally {
    await holder.close();
    await waiter.close();
  }
}

// --- The cases ---------------------------------------------------------------------------

const CASES: Case[] = [
  // Writes and DDL. Each starts with its verb, so the leading-keyword rule rejects it first.
  {
    scenario: "safety-delete",
    what: "DELETE",
    dialects: ALL,
    sql: (t) => `DELETE FROM ${t("billing", "order_line")}`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: emptiesOrderLines,
  },
  {
    scenario: "safety-update",
    what: "UPDATE",
    dialects: ALL,
    sql: (t) => `UPDATE ${t("billing", "order_line")} SET quantity = 0`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: async (p) => {
      const units = ORDER_LINES.reduce((sum, l) => sum + Number(l.quantity), 0);
      const sum = (c: ScratchConnection) => scalar(c, `SELECT SUM(quantity) AS n FROM ${p.t("billing", "order_line")}`);
      expect(await beforeAfter(p, sum)).toEqual({ before: units, after: 0 });
    },
  },
  {
    scenario: "safety-insert",
    what: "INSERT",
    dialects: ALL,
    sql: (t) => `INSERT INTO ${t("ref", "status")} (status_code, label) VALUES ('LAB', 'Lab')`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: async (p) => {
      const count = (c: ScratchConnection) => scalar(c, `SELECT COUNT(*) AS n FROM ${p.t("ref", "status")}`);
      expect(await beforeAfter(p, count)).toEqual({ before: STATUSES.length, after: STATUSES.length + 1 });
    },
  },
  {
    scenario: "safety-drop",
    what: "DROP TABLE",
    dialects: ALL,
    sql: (t) => `DROP TABLE ${t("billing", "order_line")}`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: (p) =>
      withOwner(p.scratch, async (c) => {
        const select = `SELECT COUNT(*) AS n FROM ${p.t("billing", "order_line")}`;
        expect(await scalar(c, select)).toBe(ORDER_LINES.length);
        await c.run(p.statement);
        await failsNaming(c, select, "order_line");
      }),
  },
  {
    scenario: "safety-alter",
    what: "ALTER TABLE",
    dialects: ALL,
    sql: (t) => `ALTER TABLE ${t("billing", "order_line")} ADD lab_note INT`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: (p) =>
      withOwner(p.scratch, async (c) => {
        const select = `SELECT COUNT(lab_note) AS n FROM ${p.t("billing", "order_line")}`;
        await failsNaming(c, select, "lab_note");
        await c.run(p.statement);
        expect(await scalar(c, select)).toBe(0);
      }),
  },
  {
    scenario: "safety-truncate",
    what: "TRUNCATE TABLE",
    dialects: SERVERS,
    sql: (t) => `TRUNCATE TABLE ${t("billing", "order_line")}`,
    rule: "SQL_NOT_SELECT_OR_WITH",
    proof: emptiesOrderLines,
  },

  // A harmless SELECT, then a write.
  {
    scenario: "safety-multi-statement",
    what: "SELECT, then DELETE",
    dialects: ALL,
    sql: (t) => `SELECT 1 AS ok; DELETE FROM ${t("billing", "order_line")}`,
    rule: "SQL_MULTI_STATEMENT",
    proof: emptiesOrderLines,
  },

  // Writes that start with WITH or SELECT, so only the keyword denylist stands in the way.
  {
    scenario: "safety-cte-dml",
    what: "a data-modifying CTE (WITH … AS (DELETE … RETURNING))",
    dialects: ["postgres"],
    sql: (t) => `WITH gone AS (DELETE FROM ${t("billing", "order_line")} RETURNING order_id) SELECT COUNT(*) AS deleted FROM gone`,
    rule: "SQL_FORBIDDEN_KEYWORD",
    proof: emptiesOrderLines,
  },
  {
    scenario: "safety-cte-dml",
    what: "WITH … DELETE",
    dialects: ["postgres", "mysql", "sqlserver", "sqlite"],
    sql: (t) =>
      `WITH doomed AS (SELECT order_id FROM ${t("billing", "order")}) DELETE FROM ${t("billing", "order_line")} WHERE order_id IN (SELECT order_id FROM doomed)`,
    rule: "SQL_FORBIDDEN_KEYWORD",
    proof: emptiesOrderLines,
  },
  {
    scenario: "safety-select-into",
    what: "SELECT … INTO a new table",
    dialects: ["postgres", "sqlserver"],
    sql: (t) => `SELECT * INTO ${t("billing", "lab_copy")} FROM ${t("billing", "order_line")}`,
    rule: "SQL_FORBIDDEN_KEYWORD",
    proof: (p) =>
      withOwner(p.scratch, async (c) => {
        const select = `SELECT COUNT(*) AS n FROM ${p.t("billing", "lab_copy")}`;
        await failsNaming(c, select, "lab_copy");
        await c.run(p.statement);
        expect(await scalar(c, select)).toBe(ORDER_LINES.length);
      }),
  },
  {
    scenario: "safety-for-update",
    what: "SELECT … FOR UPDATE",
    dialects: ["postgres", ...MYSQL_FAMILY],
    sql: (t) => `SELECT order_id, line_no FROM ${t("billing", "order_line")} WHERE order_id = 1 FOR UPDATE`,
    rule: "SQL_FORBIDDEN_KEYWORD",
    proof: holdsRowLock,
  },
  {
    scenario: "safety-for-update",
    what: "SELECT … WITH (UPDLOCK)",
    dialects: ["sqlserver"],
    sql: (t) => `SELECT order_id, line_no FROM ${t("billing", "order_line")} WITH (UPDLOCK) WHERE order_id = 1`,
    rule: "SQL_FORBIDDEN_KEYWORD",
    known: 319,
    proof: holdsRowLock,
  },

  // A forbidden keyword hidden in a comment: the comment itself is rejected.
  {
    scenario: "safety-comment",
    what: "DELETE inside a /* */ comment",
    dialects: ALL,
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} /* DELETE FROM ${t("org", "agency")} */`,
    rule: "SQL_COMMENT",
  },
  {
    scenario: "safety-comment",
    what: "DROP TABLE after a -- comment",
    dialects: ALL,
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} -- DROP TABLE ${t("org", "agency")}`,
    rule: "SQL_COMMENT",
  },
  {
    scenario: "safety-comment",
    what: "DELETE after a MySQL # comment",
    dialects: MYSQL_FAMILY,
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} # DELETE FROM ${t("org", "agency")}`,
    rule: "SQL_COMMENT",
  },
  {
    scenario: "safety-comment",
    what: "INTO OUTFILE inside a MySQL /*! */ executable comment",
    dialects: MYSQL_FAMILY,
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} /*!50000 INTO OUTFILE '/tmp/lab-agency.csv' */`,
    rule: "SQL_COMMENT",
  },

  // File and OS access. Rejection-only: never executed.
  {
    scenario: "safety-file-access",
    what: "COPY … TO PROGRAM",
    dialects: ["postgres"],
    sql: () => `COPY (SELECT 1) TO PROGRAM 'id'`,
    rule: "SQL_NOT_SELECT_OR_WITH",
  },
  {
    scenario: "safety-file-access",
    what: "COPY … FROM PROGRAM",
    dialects: ["postgres"],
    sql: (t) => `COPY ${t("ref", "status")} FROM PROGRAM 'cat /etc/passwd'`,
    rule: "SQL_NOT_SELECT_OR_WITH",
  },
  {
    scenario: "safety-file-access",
    what: "SELECT … INTO OUTFILE",
    dialects: MYSQL_FAMILY,
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} INTO OUTFILE '/tmp/lab-agency.csv'`,
    rule: "SQL_FORBIDDEN_KEYWORD",
  },
  {
    scenario: "safety-file-access",
    what: "LOAD_FILE()",
    dialects: MYSQL_FAMILY,
    sql: () => `SELECT LOAD_FILE('/etc/passwd') AS f`,
    rule: "SQL_FORBIDDEN_FUNCTION",
  },
  {
    scenario: "safety-file-access",
    what: "EXEC xp_cmdshell after a SELECT in one T-SQL batch",
    dialects: ["sqlserver"],
    sql: () => `SELECT 1 AS ok EXEC xp_cmdshell 'whoami'`,
    rule: "SQL_FORBIDDEN_KEYWORD",
  },

  // Session and server control. Rejection-only: never executed.
  {
    scenario: "safety-server-control",
    what: "pg_terminate_backend()",
    dialects: ["postgres"],
    sql: () => `SELECT pg_terminate_backend(pid) FROM pg_stat_activity`,
    rule: "SQL_FORBIDDEN_FUNCTION",
  },
  {
    scenario: "safety-server-control",
    what: "KILL",
    dialects: MYSQL_FAMILY,
    sql: () => `KILL 1`,
    rule: "SQL_NOT_SELECT_OR_WITH",
  },
  {
    scenario: "safety-server-control",
    what: "KILL after a SELECT in one T-SQL batch",
    dialects: ["sqlserver"],
    sql: () => `SELECT 1 AS ok KILL 52`,
    rule: "SQL_FORBIDDEN_KEYWORD",
  },
  {
    scenario: "safety-server-control",
    what: "SET GLOBAL",
    dialects: MYSQL_FAMILY,
    sql: () => `SET GLOBAL max_connections = 1`,
    rule: "SQL_NOT_SELECT_OR_WITH",
  },

  // Sleeps. Rejection-only: never executed.
  {
    scenario: "safety-sleep",
    what: "pg_sleep()",
    dialects: ["postgres"],
    sql: () => `SELECT pg_sleep(10)`,
    rule: "SQL_FORBIDDEN_FUNCTION",
  },
  {
    scenario: "safety-sleep",
    what: "SLEEP()",
    dialects: MYSQL_FAMILY,
    sql: () => `SELECT SLEEP(10) AS s`,
    rule: "SQL_FORBIDDEN_FUNCTION",
  },
  {
    scenario: "safety-sleep",
    what: "WAITFOR DELAY after a SELECT in one T-SQL batch",
    dialects: ["sqlserver"],
    sql: () => `SELECT 1 AS ok WAITFOR DELAY '00:00:10'`,
    rule: "SQL_FORBIDDEN_KEYWORD",
  },
];

/**
 * System catalogs. `concepts/safety-boundaries.mdx`: "Queries against system schemas
 * (`pg_catalog`, `information_schema`, MySQL `mysql`, SQL Server `sys`, and so on) are
 * rejected." The docs name no rule code for it, so these assert the error class only.
 */
const CATALOG_CASES: { what: string; dialects: readonly SupportedDialect[]; sql: string }[] = [
  { what: "pg_catalog", dialects: ["postgres"], sql: "SELECT rolname FROM pg_catalog.pg_roles" },
  { what: "information_schema", dialects: SERVERS, sql: "SELECT table_name FROM information_schema.tables" },
  { what: "MySQL's mysql schema", dialects: MYSQL_FAMILY, sql: "SELECT user, host FROM mysql.user" },
  { what: "MySQL's sys schema", dialects: MYSQL_FAMILY, sql: "SELECT * FROM sys.version" },
  { what: "SQL Server's sys views", dialects: ["sqlserver"], sql: "SELECT name FROM sys.objects" },
  { what: "sqlite_master", dialects: ["sqlite"], sql: "SELECT name FROM sqlite_master" },
];
const CATALOG_ISSUE = 318;

/** A quoted identifier, in each engine's own quoting (the dialects' prompt briefs, `reference/core-api.mdx`). */
function quoted(dialect: SupportedDialect, name: string): string {
  if (dialect === "mysql" || dialect === "mariadb") return `\`${name}\``;
  if (dialect === "sqlserver") return `[${name}]`;
  return `"${name}"`;
}

const AGENCIES = loadRows({ schema: "org", name: "agency" });

/** Keywords inside a quoted identifier or a string literal: accepted, unchanged, and they run. */
const ACCEPTED_CASES: { what: string; sql: (t: Name, dialect: SupportedDialect) => string }[] = [
  { what: "DELETE as a quoted identifier", sql: (t, d) => `SELECT agency_id AS ${quoted(d, "delete")} FROM ${t("org", "agency")}` },
  {
    what: "DROP TABLE, DELETE and ; inside a string literal",
    sql: (t) => `SELECT agency_id FROM ${t("org", "agency")} WHERE name <> 'DROP TABLE agency; DELETE FROM agency'`,
  },
];

// --- The suite ---------------------------------------------------------------------------

const QUESTION = "Adversarial reply from the lab's safety suite.";

/** `ask()` with `sql` as the model's reply: the error it throws, or `undefined` when it accepts. */
async function rejection(dialect: SupportedDialect, schemaDir: string, sql: string): Promise<unknown> {
  return askFixedSql(dialect, sql, schemaDir, QUESTION).then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectRejected(error: unknown, rule?: Rule): void {
  expect(error, "ask() accepted the reply").toBeInstanceOf(SqlValidationError);
  if (rule) expect((error as SqlValidationError).rule).toBe(rule);
}

/**
 * The body of an `it.fails` test for a known discrepancy. It must fail only because
 * `ask()` accepted the reply. Anything else makes the body pass, so `it.fails` reports the
 * cell as `FAIL`, not as the known issue: a rejection under the expected rule (the issue is
 * fixed: drop the `it.fails`), a rejection under another rule (a validator change to look
 * at), or any other error (a crash, a broken install).
 */
async function expectRejectedKnown(dialect: SupportedDialect, schemaDir: string, sql: string, rule?: Rule): Promise<void> {
  const error = await rejection(dialect, schemaDir, sql);
  if (error === undefined) throw new Error("ask() accepted the reply (the known discrepancy)");
  if (!(error instanceof SqlValidationError)) {
    console.error(`[${dialect}] not the known discrepancy: ask() threw something other than SqlValidationError`, error);
  } else if (rule && error.rule !== rule) {
    console.error(`[${dialect}] not the known discrepancy: rejected under ${error.rule}, not ${rule}`);
  }
}

const fixtureName =
  (dialect: SupportedDialect): Name =>
  (schema, name) =>
    physicalName(dialect, { schema, name });

describe.each(ALL.map((d) => [d] as [SupportedDialect]))("[%s]", (dialect) => {
  const cases = CASES.filter((c) => c.dialects.includes(dialect));
  let scratch: ScratchDb | undefined;
  let schemaDir = "";

  beforeAll(async () => {
    // Built here, not in each test, so a failing introspection fails the suite's cells
    // instead of passing an `it.fails` test as its known issue. A target without the
    // capability builds nothing, and each test's `needsCapability` reports `n/a`.
    if (hasCapability("cli-introspect-engine")) schemaDir = ensureArtifact(dialect);
    else if (requireInstallTarget().thisCheckout) throw new Error("this checkout lacks the documented capability cli-introspect-engine");
    if (cases.some((c) => c.proof)) scratch = await createScratch(dialect);
  });

  afterAll(async () => {
    await scratch?.drop();
  });

  for (const c of cases) {
    const name = `${c.scenario}: ask() rejects ${c.what} with SqlValidationError ${c.rule}`;
    if (c.known === undefined) {
      it(name, async (ctx: TestContext) => {
        needsCapability(ctx, "cli-introspect-engine");
        expectRejected(await rejection(dialect, schemaDir, c.sql(fixtureName(dialect), dialect)), c.rule);
      });
    } else {
      it.fails(`${name} (#${c.known})`, async (ctx: TestContext) => {
        needsCapability(ctx, "cli-introspect-engine");
        await expectRejectedKnown(dialect, schemaDir, c.sql(fixtureName(dialect), dialect), c.rule);
      });
    }

    if (c.proof) {
      const proof = c.proof;
      it(`${c.scenario}: ${c.what}, run as the owner on a scratch copy, changes its state`, async () => {
        const s = scratch!;
        await s.reset();
        const t: Name = (schema, name) => s.table({ schema, name });
        await proof({ dialect, scratch: s, statement: c.sql(t, dialect), t });
      });
    }
  }

  for (const c of CATALOG_CASES.filter((x) => x.dialects.includes(dialect))) {
    it.fails(`safety-system-catalog: ask() rejects a query on ${c.what} (#${CATALOG_ISSUE})`, async (ctx: TestContext) => {
      needsCapability(ctx, "cli-introspect-engine");
      await expectRejectedKnown(dialect, schemaDir, c.sql);
    });
  }

  for (const c of ACCEPTED_CASES) {
    it(`safety-quoted-keyword: ask() accepts ${c.what}, unchanged, and it runs`, async (ctx: TestContext) => {
      needsCapability(ctx, "cli-introspect-engine");
      const sql = c.sql(fixtureName(dialect), dialect);
      const result = await askFixedSql(dialect, sql, schemaDir, QUESTION);
      expect(result.sql).toBe(sql);
      expect((await executeReadOnly(dialect, result.sql)).rows).toHaveLength(AGENCIES.length);
    });
  }
});
