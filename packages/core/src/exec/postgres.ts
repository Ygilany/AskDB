import pg from "pg";
import { SqlExecutionError } from "../errors.js";
import type { AskDbExecutor } from "./executor.js";

export type TabularResult = {
  columns: string[];
  rows: unknown[][];
};

export async function executeReadOnlySelect(
  connectionString: string,
  sql: string,
  params?: ReadonlyArray<unknown>,
): Promise<TabularResult> {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res =
      params && params.length > 0
        ? await client.query<{ [k: string]: unknown }>(sql, params as unknown[])
        : await client.query<{ [k: string]: unknown }>(sql);
    await client.query("COMMIT");
    const fields = res.fields ?? [];
    const columns = fields.map((f) => f.name);
    const rows = res.rows.map((row) => fields.map((f) => row[f.name]));
    return { columns, rows };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new SqlExecutionError(`PostgreSQL execution failed: ${message}`, e);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Build the built-in `pg`-backed {@link AskDbExecutor} that {@link import("../ask.js").ask} uses
 * by default when only a `connectionString` is supplied.
 *
 * Each invocation runs the SQL inside a fresh connection's `BEGIN READ ONLY` transaction (see
 * {@link executeReadOnlySelect}) — the read-only invariant of the executor seam contract is
 * enforced at the database layer, not by the caller.
 *
 * Phase 4 keeps `pg` as a hard dependency of `@askdb/core`; Group 2 will move it to an optional
 * peer dependency and lazy-import it from this factory so executor-only consumers never load it.
 */
export function createPostgresExecutor(connectionString: string): AskDbExecutor {
  return (sql, params) => executeReadOnlySelect(connectionString, sql, params);
}
