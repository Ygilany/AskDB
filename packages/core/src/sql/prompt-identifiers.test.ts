import { describe, expect, it } from "vitest";
import {
  COCKROACHDB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  type DialectSpec,
} from "./dialect-spec.js";
import { promptIdentifierQuoter } from "./prompt-identifiers.js";

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

  it("keeps the stored case of a reserved word", () => {
    expect(postgres("Order")).toBe('"Order"');
  });

  it("leaves plain names bare", () => {
    for (const quote of [postgres, mysql, sqlserver, sqlite]) {
      expect(["order_id", "Agency", "_tmp", "café", "total$"].map(quote)).toEqual([
        "order_id",
        "Agency",
        "_tmp",
        "café",
        "total$",
      ]);
    }
  });

  it("quotes a name that isn't a plain identifier", () => {
    expect(postgres("order line")).toBe('"order line"');
    expect(mysql("2024_sales")).toBe("`2024_sales`");
    expect(sqlserver("unit-price")).toBe("[unit-price]");
  });

  it("doubles the closing quote inside a quoted name", () => {
    expect(postgres('a"b')).toBe('"a""b"');
    expect(mysql("a`b")).toBe("`a``b`");
    expect(sqlserver("a]b")).toBe("[a]]b]");
  });

  it("an id that is no built-in engine quotes with identifierQuote and knows no reserved words", () => {
    const quote = promptIdentifierQuoter({ id: "redshift" as DialectSpec["id"], identifierQuote: '"' });
    expect(quote("order")).toBe("order");
    expect(quote("order line")).toBe('"order line"');
  });
});
