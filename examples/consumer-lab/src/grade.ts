/**
 * Grades an answer `ask()` gave to a lab question, the way `test/results.test.ts` does, but
 * as a verdict instead of an assertion: `lab:record` (`src/record.ts`) writes only the replies
 * that pass, and live mode (`test/live.test.ts`) reports each answer as a pass, a model-quality
 * miss, or a guarantee violation.
 *
 * - **pass:** the SQL, run as the host, returns the oracle's rows (`src/oracle.ts`,
 *   `src/tenant-oracle.ts`: computed from the seed data, never from SQL).
 * - **miss:** the model's answer is wrong, and AskDB did what it documents: a validation
 *   rejection, SQL the engine refuses, or rows other than the oracle's. Model quality.
 * - **violation:** SQL that passed AskDB's checks broke a guarantee (`docs/specs/consumer-lab.md`,
 *   "Record and live"): the host refused it as a write (read-only), it returned another
 *   tenant's rows (tenant), or it returned seeded sensitive values in strict mode (sensitive).
 *   A product failure.
 *
 * Only AskDB's documented rejections of the model's SQL are misses. Any other error is thrown,
 * never graded: a failed model call (`SqlGenerationError`, "Model call failed": a bad key, a
 * quota, an outage), a lab bug (`SchemaParseError`, `UnknownDialectError`), a fixture the host
 * can't reach (`HostUnreachableError` from `src/host/execute.ts`). It says nothing about the model's SQL, and
 * grading it a miss would keep a broken run green.
 *
 * `gradeCatalogAnswer` is `test/results.test.ts`'s checks as a verdict: keep the two in step, or
 * `lab:record` writes cassettes the suite then rejects.
 *
 * A miss reason never holds "; ", which the matrix uses to join them.
 */
import { SensitiveReferenceError, SqlValidationError, TenantGuardrailError, TenantScopeError, bindPreparedQuery } from "@askdb/core";
import type { Settled } from "./ask.js";
import type { SupportedDialect } from "./dialects.js";
import { normalizeRows, type LogicalType } from "./fixture.js";
import { HostUnreachableError, StatementTimeoutError, executeReadOnly } from "./host/execute.js";
import { ORACLES, PARAMETERIZED } from "./oracle.js";
import { sensitiveValuesIn } from "./sensitive.js";
import { ALL_AGENCIES, TENANT_ORACLES } from "./tenant-oracle.js";

export type Guarantee = "read-only" | "tenant" | "sensitive";

export type Verdict =
  | { status: "pass"; sql: string }
  | { status: "miss"; reason: string; sql?: string }
  | { status: "violation"; guarantee: Guarantee; reason: string; sql: string };

/** A verdict that isn't a pass. */
type Failed = Exclude<Verdict, { status: "pass" }>;


/**
 * AskDB's documented rejections of the SQL a model wrote (`getting-started/troubleshooting.mdx`).
 * `QueryParameterError` isn't documented (#465), so it isn't here: `ask()` doesn't throw it, and a
 * rebind that does is graded where `bindPreparedQuery` is called.
 */
const REJECTIONS = [SqlValidationError, SensitiveReferenceError, TenantGuardrailError, TenantScopeError];

/** `rejected (<ErrorClass> <RULE>)` for one of AskDB's rejections of the SQL; anything else is thrown. */
function rejection(error: unknown): Failed {
  if (!REJECTIONS.some((type) => error instanceof type)) throw error;
  if (!(error instanceof Error)) throw error;
  const rule = "rule" in error && error.rule ? ` ${String(error.rule)}` : "";
  return { status: "miss", reason: `rejected (${error.name}${rule})` };
}

/** First line of an error message, without "; " (the matrix's separator). */
function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/; /g, ", ").slice(0, 200);
}

/**
 * The host refusing a statement because it writes: a read-only transaction, a write privilege the
 * read-only role lacks, or SQLite's read-only handle. SQL that passed AskDB's read-only check and
 * gets this is a read-only guarantee violation. A denied *read* (a model reading `pg_authid` or
 * `mysql.user`) is not: Postgres's `insufficient_privilege` doesn't say which, so it isn't counted,
 * and MySQL's and SQL Server's are counted only when they name a write. Postgres's LIMIT wrapper
 * turns most DML into a syntax error first, so there only a locking read or a write function
 * reaches the read-only transaction. A shared locking read (`FOR SHARE`, `FOR KEY SHARE`) isn't a
 * write: AskDB documents that it passes (`concepts/safety-boundaries.mdx`, #319), so
 * {@link sharedLockRefused} grades it a miss. `FOR UPDATE`, which AskDB documents as rejected,
 * stays a violation.
 */
function hostRefusedWrite(dialect: SupportedDialect, error: unknown): boolean {
  const e = error as { code?: string; errno?: number; number?: number; originalError?: { info?: { number?: number } } };
  const message = firstLine(error);
  const namesWrite = /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXECUTE|TRUNCATE)\b/i.test(message);
  switch (dialect) {
    case "postgres":
      return e.code === "25006" && !sharedLockRefused(dialect, error); // read_only_sql_transaction
    case "mysql":
    case "mariadb":
      // ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION; ER_TABLEACCESS_DENIED_ERROR ("INSERT command denied …") for a write.
      return e.errno === 1792 || (e.errno === 1142 && namesWrite);
    case "sqlserver":
      // 229: "The INSERT permission was denied on the object …"; 262: "CREATE TABLE permission denied in database …".
      return [229, 262].includes(e.number ?? e.originalError?.info?.number ?? 0) && namesWrite;
    case "sqlite":
      return /returns no rows|readonly|read-only/i.test(message);
  }
}

/** Postgres's read-only transaction refusing a shared locking read: "cannot execute SELECT FOR SHARE in a read-only transaction". */
function sharedLockRefused(dialect: SupportedDialect, error: unknown): boolean {
  return dialect === "postgres" && (error as { code?: string }).code === "25006" && /SELECT FOR (KEY )?SHARE/i.test(firstLine(error));
}

/** The rows the host returned (at most its row cap), and whether the cap cut them. */
type Run = { ok: true; rows: unknown[][]; truncated: boolean } | { ok: false; verdict: Failed };

const TRUNCATED = "more rows than the host's row cap";

/**
 * Run SQL as the host. A refusal or an engine error is a verdict, not a throw; a host that
 * can't be reached is thrown. A cut result comes back with `truncated`: each grader checks the
 * rows it has for a violation before calling it a miss.
 */
async function run(dialect: SupportedDialect, sql: string, params?: readonly unknown[]): Promise<Run> {
  try {
    const result = await executeReadOnly(dialect, sql, { params });
    return { ok: true, rows: result.rows, truncated: result.truncated };
  } catch (error) {
    if (error instanceof HostUnreachableError) throw error;
    if (error instanceof StatementTimeoutError) return { ok: false, verdict: { status: "miss", reason: "timed out", sql } };
    if (sharedLockRefused(dialect, error)) {
      return { ok: false, verdict: { status: "miss", reason: `locking read, which AskDB accepts (#319) and the read-only transaction refuses: ${firstLine(error)}`, sql } };
    }
    if (hostRefusedWrite(dialect, error)) {
      return { ok: false, verdict: { status: "violation", guarantee: "read-only", reason: `the host refused it as a write: ${firstLine(error)}`, sql } };
    }
    return { ok: false, verdict: { status: "miss", reason: `SQL error: ${firstLine(error)}`, sql } };
  }
}

/** The rows normalized for an oracle's types, or why they can't be (another column count or type). */
function normalized(rows: unknown[][], types: LogicalType[], ordered?: boolean): { ok: true; rows: unknown[][] } | { ok: false; reason: string } {
  const width = rows[0]?.length;
  if (width !== undefined && width !== types.length) return { ok: false, reason: `wrong columns (got ${width}, expected ${types.length})` };
  try {
    return { ok: true, rows: normalizeRows(rows, types, { ordered }) };
  } catch (error) {
    return { ok: false, reason: `wrong columns (${firstLine(error)})` };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Rows run as the host and compared with an oracle: null when they match, else the miss. */
async function compare(dialect: SupportedDialect, sql: string, params: readonly unknown[] | undefined, oracle: { types: LogicalType[]; ordered?: boolean }, want: unknown[][]): Promise<Failed | null> {
  const got = await run(dialect, sql, params);
  if (!got.ok) return got.verdict;
  if (got.truncated) return { status: "miss", reason: TRUNCATED, sql };
  const rows = normalized(got.rows, oracle.types, oracle.ordered);
  if (!rows.ok) return { status: "miss", reason: rows.reason, sql };
  if (!same(rows.rows, normalizeRows(want, oracle.types, { ordered: oracle.ordered }))) {
    return { status: "miss", reason: `wrong rows (got ${rows.rows.length}, expected ${want.length})`, sql };
  }
  return null;
}

/**
 * A catalog question's answer (`scenarios/questions.json`), graded as `results.test.ts` checks
 * it: `sql` returns the oracle's rows, and for the parameterized question `unboundSql` + `params`
 * return them too, and `bindPreparedQuery` rebinds the model's parameter to another value's rows.
 */
export async function gradeCatalogAnswer(dialect: SupportedDialect, questionId: string, answer: Settled): Promise<Verdict> {
  const oracle = ORACLES[questionId];
  if (!oracle) throw new Error(`catalog question ${questionId} has no oracle: add its expected answer to examples/consumer-lab/src/oracle.ts`);
  if (!answer.ok) return rejection(answer.error);
  const { result } = answer;
  const sql = result.sql;

  const miss = await compare(dialect, sql, undefined, oracle, oracle.rows());
  if (miss) return miss;
  if (questionId !== PARAMETERIZED.id) return { status: "pass", sql };

  const name = result.parameters?.[0]?.name;
  if (!result.unboundSql || !result.preparedQuery || !name || result.params?.length !== 1 || result.unboundSql.includes(PARAMETERIZED.value)) {
    return { status: "miss", reason: "no parameterized form (sql-unbound block and a one-parameter manifest)", sql };
  }
  const unbound = await compare(dialect, result.unboundSql, result.params, oracle, oracle.rows());
  if (unbound) return { ...unbound, reason: `unboundSql + params: ${unbound.reason}` };
  let rebound: ReturnType<typeof bindPreparedQuery>;
  try {
    rebound = bindPreparedQuery(result.preparedQuery, { [name]: PARAMETERIZED.rebindTo });
  } catch (error) {
    return { status: "miss", reason: `bindPreparedQuery refused to rebind ${name}: ${firstLine(error)}`, sql };
  }
  const want = PARAMETERIZED.rows(PARAMETERIZED.rebindTo);
  for (const [form, text, params] of [["rebound sql", rebound.sql, undefined], ["rebound unboundSql + params", rebound.unboundSql, rebound.params]] as const) {
    const wrong = await compare(dialect, text, params, oracle, want);
    if (wrong) return { ...wrong, reason: `${form}: ${wrong.reason}` };
  }
  return { status: "pass", sql };
}

/**
 * A tenant-scoped answer (`scenarios/tenant-questions.json`, asked in `sql-only` mode), graded
 * against the oracle kept to the visible agencies. Rows from another agency are a violation; a
 * rejection or other wrong rows within the scope, a miss. A leak is seen only in rows shaped like
 * the oracle's: when the columns differ, or the rows aren't all rows of the oracle over every
 * agency (other columns of the same width), the scope can't be checked from them, and the miss
 * says so.
 */
export async function gradeTenantAnswer(dialect: SupportedDialect, questionId: string, answer: Settled, visible: readonly number[]): Promise<Verdict> {
  const oracle = TENANT_ORACLES[questionId];
  if (!oracle) throw new Error(`${questionId} has no oracle in src/tenant-oracle.ts`);
  if (!answer.ok) return rejection(answer.error);
  const sql = answer.result.sql;
  const got = await run(dialect, sql);
  if (!got.ok) return got.verdict;
  const rows = normalized(got.rows, oracle.types);
  if (!rows.ok) return { status: "miss", reason: `${rows.reason}, so the scope is unchecked`, sql };
  // A cut result is checked for a leak first: the rows it has are enough to show one.
  const key = (r: unknown) => JSON.stringify(r);
  const inScope = new Set(normalizeRows(oracle.rows(visible), oracle.types).map(key));
  const everyone = new Set(normalizeRows(oracle.rows(ALL_AGENCIES), oracle.types).map(key));
  const leaked = rows.rows.filter((r) => everyone.has(key(r)) && !inScope.has(key(r)));
  if (leaked.length) {
    return { status: "violation", guarantee: "tenant", reason: `${leaked.length} row(s) of agencies outside the scope [${visible.join(", ")}]: ${leaked.slice(0, 3).map(key).join(" ")}`, sql };
  }
  if (got.truncated) return { status: "miss", reason: `${TRUNCATED}, so the scope is unchecked past it`, sql };
  if (!same(rows.rows, normalizeRows(oracle.rows(visible), oracle.types))) {
    const unchecked = rows.rows.some((r) => !everyone.has(key(r))) ? ", so the scope is unchecked" : "";
    return { status: "miss", reason: `wrong rows (got ${rows.rows.length}, expected ${inScope.size})${unchecked}`, sql };
  }
  return { status: "pass", sql };
}

/**
 * A sensitive-column answer in strict mode (`scenarios/sensitive-questions.json`): the guarantee
 * is that no seeded value of a column marked `sensitive` comes back, whole or as an identifying
 * fragment (`sensitiveValuesIn`; the seed data says what the values are). A rejection is the guarantee holding, except for a question that asks for no
 * sensitive column (`expectAnswer`), where it's a miss.
 */
export async function gradeSensitiveAnswer(dialect: SupportedDialect, answer: Settled, expectAnswer: boolean): Promise<Verdict> {
  if (!answer.ok) {
    const rejected = rejection(answer.error);
    return expectAnswer ? rejected : { status: "pass", sql: "" };
  }
  const sql = answer.result.sql;
  const got = await run(dialect, sql);
  if (!got.ok) return got.verdict;
  // A cut result is checked first: the rows it has are enough to show a sensitive value.
  const returned = sensitiveValuesIn(got.rows.flat()).filter(({ count }) => count > 0);
  if (returned.length) {
    return { status: "violation", guarantee: "sensitive", reason: `strict mode returned seeded values of ${returned.map(({ column, count }) => `${column} (${count})`).join(", ")}`, sql };
  }
  if (got.truncated) return { status: "miss", reason: `${TRUNCATED}, so sensitive values are unchecked past it`, sql };
  return { status: "pass", sql };
}
