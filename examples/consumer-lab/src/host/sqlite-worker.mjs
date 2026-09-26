/**
 * Runs one read-only SQLite statement for `execute.ts`. better-sqlite3 is synchronous
 * and can't interrupt a running statement, so the host runs it in a worker thread and
 * terminates the worker when the statement timeout passes.
 *
 * Plain `.mjs` so that it loads in a worker under any runner (tsx, vitest, node).
 */
import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";

const { file, sql, params, rowCap } = workerData;
let db;
try {
  db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  // The statement timeout starts now, not while the worker and the driver were loading.
  parentPort.postMessage({ ready: true });
  const stmt = db.prepare(sql);
  if (!stmt.reader) throw new Error("the statement returns no rows");
  stmt.raw(true);
  const columns = stmt.columns().map((c) => c.name);
  const rows = [];
  // Stop reading once the cap is exceeded: one extra row only says the result was truncated.
  for (const row of stmt.iterate(...params)) {
    rows.push(row);
    if (rows.length > rowCap) break;
  }
  parentPort.postMessage({ ok: true, columns, rows });
} catch (error) {
  parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
} finally {
  db?.close();
}
