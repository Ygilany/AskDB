/**
 * The lab is AskDB's host, so it executes the SQL `ask()` returns, the way the operator
 * checklist says a host should (apps/docs-site guides/run-safely-in-prod): as a
 * read-only role, inside a read-only transaction where the engine has one, with a
 * statement timeout and a row cap. Drivers are used directly; AskDB never executes SQL.
 *
 * | Engine     | Read-only                                  | Timeout                   | Row cap                         |
 * |------------|--------------------------------------------|---------------------------|---------------------------------|
 * | Postgres   | `fixture_reader`, `BEGIN READ ONLY`        | `statement_timeout`       | the checklist's LIMIT wrapper   |
 * | MySQL      | `fixture_reader`, `START TRANSACTION READ ONLY` | `max_execution_time` | stop reading after cap + 1 rows |
 * | MariaDB    | `fixture_reader`, `START TRANSACTION READ ONLY` | `max_statement_time` | stop reading after cap + 1 rows |
 * | SQL Server | `fixture_reader` (no read-only transaction exists) | request timeout (cancels) | `SET ROWCOUNT cap + 1` |
 * | SQLite     | read-only file handle, `query_only`        | child process killed      | stop reading after cap + 1 rows |
 *
 * The checklist's `SELECT * FROM (…) LIMIT n` wrapper is invalid on SQL Server and loses
 * the statement's ORDER BY on MariaDB (#266), so only Postgres uses it.
 */
import { fork } from "node:child_process";
import mssql from "mssql";
import mysql from "mysql2";
import pg from "pg";
import { SQLITE_FILE, connectionUrl } from "../fixture.js";
import type { SupportedDialect } from "../dialects.js";

export interface ExecuteOptions {
  /** Rows returned to the caller. One extra row is read only to tell whether the cap truncated the result. */
  rowCap?: number;
  statementTimeoutMs?: number;
  params?: readonly unknown[];
}

export interface ExecuteResult {
  columns: string[];
  /** At most `rowCap` rows. */
  rows: unknown[][];
  /** True when the statement produced more than `rowCap` rows. */
  truncated: boolean;
}

/** The statement ran past the statement timeout and was stopped. */
export class StatementTimeoutError extends Error {
  constructor(
    readonly dialect: SupportedDialect,
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(`[${dialect}] statement timed out after ${timeoutMs} ms`, options);
    this.name = "StatementTimeoutError";
  }
}

interface Resolved {
  rowCap: number;
  timeoutMs: number;
  params: unknown[];
}

export async function executeReadOnly(dialect: SupportedDialect, sql: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const o: Resolved = {
    rowCap: opts.rowCap ?? 100,
    timeoutMs: Math.trunc(opts.statementTimeoutMs ?? 5000),
    params: opts.params ? [...opts.params] : [],
  };
  // A trailing semicolon is allowed in AskDB's output (the NL→SQL prompt's "optional
  // semicolon"), but it would break a wrapper around the statement.
  const statement = sql.trim().replace(/;\s*$/, "");
  const read = await RUNNERS[dialect](statement, o, dialect);
  return { columns: read.columns, rows: read.rows.slice(0, o.rowCap), truncated: read.rows.length > o.rowCap };
}

/** Each runner returns at most rowCap + 1 rows. */
type Runner = (sql: string, o: Resolved, dialect: SupportedDialect) => Promise<{ columns: string[]; rows: unknown[][] }>;

const RUNNERS: Record<SupportedDialect, Runner> = {
  postgres: runPostgres,
  mysql: runMysql,
  mariadb: runMysql,
  sqlserver: runSqlServer,
  sqlite: runSqlite,
};

// Return date/time values as the server renders them; the fixture's timestamps are naive UTC.
const PG_RAW_TYPES = new Set([1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]);

async function runPostgres(sql: string, o: Resolved) {
  const client = new pg.Client({
    connectionString: connectionUrl("postgres", "reader"),
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        PG_RAW_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${o.timeoutMs}`);
    const capped = `SELECT * FROM (${sql}) AS askdb_q LIMIT ${o.rowCap + 1}`;
    const result = await client.query({ text: capped, values: o.params, rowMode: "array" });
    return { columns: result.fields.map((f) => f.name), rows: result.rows as unknown[][] };
  } catch (error) {
    // 57014 query_canceled: what statement_timeout raises.
    if ((error as { code?: string }).code === "57014") throw new StatementTimeoutError("postgres", o.timeoutMs, { cause: error });
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

// ER_QUERY_TIMEOUT (MySQL max_execution_time) and ER_STATEMENT_TIMEOUT (MariaDB max_statement_time).
const MYSQL_TIMEOUT_ERRNOS = new Set([3024, 1969]);

async function runMysql(sql: string, o: Resolved, dialect: SupportedDialect) {
  // The callback connection streams rows; its promise() wrapper runs the setup statements.
  const conn = mysql.createConnection({
    uri: connectionUrl(dialect as "mysql" | "mariadb", "reader"),
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: "utf8mb4",
  });
  const setup = conn.promise();
  let stoppedEarly = false;
  try {
    await setup.query(
      dialect === "mariadb"
        ? `SET SESSION max_statement_time = ${o.timeoutMs / 1000}`
        : `SET SESSION max_execution_time = ${o.timeoutMs}`,
    );
    await setup.query("START TRANSACTION READ ONLY");
    return await new Promise<{ columns: string[]; rows: unknown[][] }>((resolve, reject) => {
      let columns: string[] = [];
      const rows: unknown[][] = [];
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      conn
        .query({ sql, values: o.params, rowsAsArray: true })
        .on("fields", (fields: { name: string }[]) => {
          columns = fields.map((f) => f.name);
        })
        .on("result", (row: unknown) => {
          rows.push(row as unknown[]);
          if (rows.length > o.rowCap) {
            // Enough to know the result is truncated: drop the connection instead of reading the rest.
            stoppedEarly = true;
            conn.destroy();
            settle(() => resolve({ columns, rows }));
          }
        })
        .on("error", (error: { errno?: number }) =>
          settle(() =>
            reject(MYSQL_TIMEOUT_ERRNOS.has(error.errno ?? 0) ? new StatementTimeoutError(dialect, o.timeoutMs, { cause: error }) : error),
          ),
        )
        .on("end", () => settle(() => resolve({ columns, rows })));
    });
  } finally {
    if (!stoppedEarly) {
      await setup.query("ROLLBACK").catch(() => undefined);
      await setup.end().catch(() => undefined);
    }
  }
}

async function runSqlServer(sql: string, o: Resolved) {
  const pool = new mssql.ConnectionPool({
    ...mssql.ConnectionPool.parseConnectionString(connectionUrl("sqlserver", "reader")),
    requestTimeout: o.timeoutMs,
    arrayRowMode: true,
  });
  const tx = new mssql.Transaction(pool);
  let begun = false;
  try {
    await pool.connect();
    await tx.begin();
    begun = true;
    // Caps the rows any following statement returns, and keeps its ORDER BY.
    await new mssql.Request(tx).batch(`SET ROWCOUNT ${o.rowCap + 1}`);
    const request = new mssql.Request(tx);
    o.params.forEach((value, i) => request.input(`p${i}`, value));
    const result = await request.query(sql);
    const recordset = result.recordset ?? [];
    const meta = (recordset as unknown as { columns?: unknown }).columns;
    const columns = Array.isArray(meta) ? (meta as { name: string }[]).map((c) => c.name) : Object.keys(meta ?? {});
    return { columns, rows: [...recordset] as unknown as unknown[][] };
  } catch (error) {
    if ((error as { code?: string }).code === "ETIMEOUT") throw new StatementTimeoutError("sqlserver", o.timeoutMs, { cause: error });
    throw error;
  } finally {
    if (begun) await tx.rollback().catch(() => undefined);
    await pool.close().catch(() => undefined);
  }
}

/**
 * better-sqlite3 is synchronous and can't interrupt a running statement, and a worker
 * thread can't be stopped while it is inside native code. So the statement runs in a
 * child process, which the timeout kills outright.
 */
async function runSqlite(sql: string, o: Resolved) {
  const child = fork(new URL("./sqlite-worker.mjs", import.meta.url), [], {
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  child.send({ file: SQLITE_FILE, sql, params: o.params, rowCap: o.rowCap });
  try {
    return await new Promise<{ columns: string[]; rows: unknown[][] }>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      type Message = { ready: true } | { ok: true; columns: string[]; rows: unknown[][] } | { ok: false; message: string };
      child.on("message", (message: Message) => {
        if ("ready" in message) {
          // The database is open; from here on the statement is running.
          timer = setTimeout(() => settle(() => reject(new StatementTimeoutError("sqlite", o.timeoutMs))), o.timeoutMs);
        } else if (message.ok) settle(() => resolve({ columns: message.columns, rows: message.rows }));
        else settle(() => reject(new Error(`[sqlite] ${message.message}`)));
      });
      child.once("error", (error) => settle(() => reject(error)));
      child.once("exit", (code, signal) =>
        settle(() => reject(new Error(`[sqlite] the statement process exited (${signal ?? `code ${code}`}) without a result`))),
      );
    });
  } finally {
    // Not awaited: a killed process stops at once, native code included.
    child.kill("SIGKILL");
  }
}
