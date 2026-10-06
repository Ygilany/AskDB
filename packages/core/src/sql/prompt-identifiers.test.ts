import { describe, expect, it } from "vitest";
import {
  COCKROACHDB_DIALECT,
  MARIADB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  type DialectSpec,
} from "./dialect-spec.js";
import { promptIdentifierQuoter } from "./prompt-identifiers.js";
import { validateSelectSql } from "./validate.js";

describe("promptIdentifierQuoter", () => {
  const postgres = promptIdentifierQuoter(POSTGRES_DIALECT);
  const mysql = promptIdentifierQuoter(MYSQL_DIALECT);
  const sqlserver = promptIdentifierQuoter(SQLSERVER_DIALECT);
  const sqlite = promptIdentifierQuoter(SQLITE_DIALECT);

  it("quotes a word only on the engines that reserve it", () => {
    expect([postgres("user"), mysql("user"), sqlserver("user")]).toEqual(['"user"', "user", "[user]"]);
    expect([postgres("rank"), mysql("rank"), sqlserver("rank")]).toEqual(["rank", "`rank`", "rank"]);
    expect(sqlite("key")).toBe('"key"');
    expect([postgres("family"), promptIdentifierQuoter(COCKROACHDB_DIALECT)("family")]).toEqual(["family", '"family"']);
  });

  it("matches reserved words in any case and keeps the stored case", () => {
    // Engines that don't fold case, so only the reserved-word lookup can quote these.
    expect([mysql("ORDER"), sqlserver("Group"), sqlite("Key")]).toEqual(["`ORDER`", "[Group]", '"Key"']);
  });

  it("quotes words MariaDB and MySQL servers reject bare that their docs don't list", () => {
    expect([promptIdentifierQuoter(MARIADB_DIALECT)("portion"), mysql("sql_no_cache")]).toEqual(["`portion`", "`sql_no_cache`"]);
  });

  it("quotes the words AskDB's validator rejects unquoted, on every engine", () => {
    for (const [quote, open, close] of [[postgres, '"', '"'], [mysql, "`", "`"], [sqlserver, "[", "]"], [sqlite, '"', '"']] as const) {
      expect(quote("copy")).toBe(`${open}copy${close}`);
    }
    // A dialect's own extraForbiddenKeywords count too: `set` on SQL Server only.
    expect([sqlserver("set"), postgres("set")]).toEqual(["[set]", "set"]);
  });

  it("leaves plain names bare", () => {
    for (const quote of [postgres, mysql, sqlserver, sqlite]) {
      expect(["order_id", "_tmp", "total$"].map(quote)).toEqual(["order_id", "_tmp", "total$"]);
    }
    expect([postgres("café"), mysql("café"), sqlite("café")]).toEqual(["café", "café", "café"]);
  });

  it("on SQL Server, leaves only ASCII names bare: T-SQL rejects letters outside Unicode 3.2 and the BMP", () => {
    expect([sqlserver("café"), sqlserver("𠮷田"), sqlserver("ẞtraße")]).toEqual(["[café]", "[𠮷田]", "[ẞtraße]"]);
  });

  it("quotes a name with capitals only on Postgres and CockroachDB, which fold unquoted names to lowercase", () => {
    const cockroach = promptIdentifierQuoter(COCKROACHDB_DIALECT);
    expect([postgres("Post"), postgres("createdAt"), cockroach("createdAt")]).toEqual(['"Post"', '"createdAt"', '"createdAt"']);
    expect([mysql("createdAt"), sqlserver("createdAt"), sqlite("createdAt")]).toEqual(["createdAt", "createdAt", "createdAt"]);
  });

  it("quotes a name that isn't a plain identifier", () => {
    expect(postgres("order line")).toBe('"order line"');
    expect(mysql("2024_sales")).toBe("`2024_sales`");
    expect(sqlserver("unit-price")).toBe("[unit-price]");
    // T-SQL allows only decimal digits after the first character.
    expect(sqlserver("area²")).toBe("[area²]");
  });

  it("doubles the closing quote inside a quoted name", () => {
    expect(postgres('a"b')).toBe('"a""b"');
    expect(mysql("a`b")).toBe("`a``b`");
    expect(sqlserver("a]b")).toBe("[a]]b]");
  });

  it("reads the reserved words from the spec: a spread keeps them, setting the field replaces them", () => {
    const spread = promptIdentifierQuoter({ ...POSTGRES_DIALECT, displayName: "Amazon Redshift" });
    expect(spread("order")).toBe('"order"');
    // Case-insensitive on the list side too: a list copied from uppercase docs still works.
    const replaced = promptIdentifierQuoter({ ...POSTGRES_DIALECT, reservedWords: ["WIDGET"] });
    expect([replaced("widget"), replaced("order")]).toEqual(['"widget"', "order"]);
  });

  it("an id that is no built-in engine quotes with identifierQuote", () => {
    const quote = promptIdentifierQuoter({ id: "redshift" as DialectSpec["id"], identifierQuote: '"', reservedWords: ["order"] });
    expect([quote("order"), quote("order line"), quote("Post")]).toEqual(['"order"', '"order line"', "Post"]);
  });

  it("an id that is no built-in engine quotes every word the validator rejects for it", () => {
    // The validator reads such SQL every engine's way, so SQL Server's `set` is rejected bare too.
    const spec = { ...POSTGRES_DIALECT, id: "redshift" as DialectSpec["id"] };
    const quote = promptIdentifierQuoter(spec);
    expect(quote("set")).toBe('"set"');
    expect(validateSelectSql(spec, `SELECT ${quote("set")} FROM t`)).toBe('SELECT "set" FROM t');
    expect(() => validateSelectSql(spec, "SELECT set FROM t")).toThrow(/SET/i);
  });
});
