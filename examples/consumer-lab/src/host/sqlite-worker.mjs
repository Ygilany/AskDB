/**
 * Runs one read-only SQLite statement for `execute.ts`, in a child process of its own.
 * better-sqlite3 is synchronous and can't interrupt a running statement, so the host
 * kills this process when the statement timeout passes.
 *
 * Plain `.mjs` so that it runs under any runner (tsx, vitest, node).
 */
import Database from "better-sqlite3";

process.once("message", ({ file, sql, params, rowCap }) => {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    // The statement timeout starts now, not while the process and the driver were loading.
    process.send({ ready: true });
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
    process.send({ ok: true, columns, rows });
  } catch (error) {
    process.send({ ok: false, message: error instanceof Error ? error.message : String(error) });
  } finally {
    db?.close();
  }
});
