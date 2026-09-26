/**
 * The lab is AskDB's host, so it executes the SQL `ask()` returns, the way the operator
 * checklist says a host should (apps/docs-site guides/run-safely-in-prod): as a
 * read-only role, inside a read-only transaction, with a statement timeout and a row cap.
 * Drivers are used directly; AskDB never executes SQL.
 */
import pg from "pg";
import { connectionUrl } from "../fixture.js";
import type { SupportedDialect } from "../dialects.js";

export interface ExecuteOptions {
  /** Rows returned to the caller; the statement is wrapped in a LIMIT of rowCap + 1. */
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

// Return date/time values as the server renders them; the fixture's timestamps are naive UTC.
const PG_RAW_TYPES = new Set([1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]);

export async function executeReadOnly(_dialect: SupportedDialect, sql: string, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const rowCap = opts.rowCap ?? 100;
  // The checklist's hard row cap: wrap the statement before executing it. One extra row
  // is fetched only to tell whether the cap truncated the result.
  const capped = `SELECT * FROM (${sql}) AS askdb_q LIMIT ${rowCap + 1}`;
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
    const result = await client.query({ text: capped, values: opts.params ? [...opts.params] : [], rowMode: "array" });
    const rows = result.rows as unknown[][];
    return {
      columns: result.fields.map((f) => f.name),
      rows: rows.slice(0, rowCap),
      truncated: rows.length > rowCap,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
