import { describe, expect, it } from "vitest";
import { maskSqlLiterals } from "./mask-literals.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT, SQLSERVER_DIALECT } from "./dialect-spec.js";

describe("maskSqlLiterals", () => {
  it("replaces strings and numbers with ? and drops comments, keeping names and structure", () => {
    const sql = `SELECT region, SUM(total) AS revenue FROM orders WHERE tenant_id = 'tenant-4471' AND total > 1250 -- big orders\nGROUP BY region LIMIT 50`;
    expect(maskSqlLiterals(sql, POSTGRES_DIALECT)).toBe(
      "SELECT region, SUM(total) AS revenue FROM orders WHERE tenant_id = ? AND total > ?  \nGROUP BY region LIMIT ?",
    );
  });

  it("keeps parameters, which hold no values", () => {
    expect(maskSqlLiterals("SELECT id FROM t WHERE tenant_id = $1", POSTGRES_DIALECT)).toBe(
      "SELECT id FROM t WHERE tenant_id = $1",
    );
  });

  it("masks prefixed and engine-specific literals", () => {
    const pg = maskSqlLiterals("SELECT E'a\\'b', x'ff', $t$secret$t$, DATE '2024-01-01'", POSTGRES_DIALECT)!;
    expect(pg).toBe("SELECT ?, ?, ?, DATE ?");
    const ms = maskSqlLiterals("SELECT N'Acme', 0xFF, $1.5", SQLSERVER_DIALECT)!;
    expect(ms).toBe("SELECT ?, ?, ?");
  });

  it("masks MySQL double-quoted strings and executable-comment bodies", () => {
    const out = maskSqlLiterals(`SELECT "Acme" AS c, /*!50000 'hidden' */ 1`, MYSQL_DIALECT)!;
    expect(out).not.toMatch(/Acme|hidden|1/);
  });

  it("reads SQL every engine's way when the dialect is unknown or missing", () => {
    // Under MySQL `"…"` is a string, so the safe reading masks it even though Postgres reads a name.
    for (const dialect of [undefined, { id: "duckdb" }]) {
      const out = maskSqlLiterals(`SELECT "Acme Corp", 'x', 42 FROM t`, dialect)!;
      expect(out).not.toMatch(/Acme|'x'|42/);
    }
    // A backslash ends the string under one string setting and escapes the quote under the other;
    // where one reading never closes a string, nothing is returned.
    expect(maskSqlLiterals(String.raw`SELECT 'a\' , 'secret-b' FROM t`)).toBeUndefined();
  });

  it("returns undefined when a token never ends", () => {
    expect(maskSqlLiterals("SELECT 'unterminated FROM t", POSTGRES_DIALECT)).toBeUndefined();
    expect(maskSqlLiterals("SELECT 1 /* open", undefined)).toBeUndefined();
  });

  it("names a dialect by id the same as by spec", () => {
    const sql = "SELECT 'v' FROM t";
    expect(maskSqlLiterals(sql, { id: "postgres" })).toBe(maskSqlLiterals(sql, POSTGRES_DIALECT));
  });
});
