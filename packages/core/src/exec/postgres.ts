import pg from "pg";
import { SqlExecutionError } from "../errors.js";

export type TabularResult = {
  columns: string[];
  rows: unknown[][];
};

export async function executeReadOnlySelect(connectionString: string, sql: string): Promise<TabularResult> {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const res = await client.query<{ [k: string]: unknown }>(sql);
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
