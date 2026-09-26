/**
 * The lab is AskDB's host, so it executes the SQL `ask()` returns, the way the operator
 * checklist says a host should (apps/docs-site guides/run-safely-in-prod): as a
 * read-only role, inside a read-only transaction, with a statement timeout and a row cap.
 * Drivers are used directly; AskDB never executes SQL.
 */
import pg from "pg";
import { connectionUrl, type Dialect } from "../fixture.js";

export interface ExecuteOptions {
  /** Rows returned to the caller; the full count is still reported. */
  rowCap?: number;
  statementTimeoutMs?: number;
  params?: readonly unknown[];
}

export interface ExecuteResult {
  columns: string[];
  rows: unknown[][];
  /** Rows the statement produced, before the cap. */
  total: number;
  truncated: boolean;
}

// Return date/time values as the server renders them; the fixture's timestamps are naive UTC.
const PG_RAW_TYPES = new Set([1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]);

export async function executeReadOnly(dialect: Dialect, sql: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  if (dialect !== "postgres") {
    throw new Error(`Executing on ${dialect} isn't supported yet (see #243).`);
  }
  const rowCap = opts.rowCap ?? 100;
  const client = new pg.Client({
    connectionString: connectionUrl("postgres", "reader"),
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") =>
        PG_RAW_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(opts.statementTimeoutMs ?? 5000)}`);
    const result = await client.query({ text: sql, values: opts.params ? [...opts.params] : [], rowMode: "array" });
    const rows = result.rows as unknown[][];
    return {
      columns: result.fields.map((f) => f.name),
      rows: rows.slice(0, rowCap),
      total: rows.length,
      truncated: rows.length > rowCap,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
