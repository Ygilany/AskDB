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
      expect(["order_id", "_tmp", "café", "total$"].map(quote)).toEqual(["order_id", "_tmp", "café", "total$"]);
    }
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
  });

  it("doubles the closing quote inside a quoted name", () => {
    expect(postgres('a"b')).toBe('"a""b"');
    expect(mysql("a`b")).toBe("`a``b`");
    expect(sqlserver("a]b")).toBe("[a]]b]");
  });

  it("reads the reserved words from the spec: a spread keeps them, setting the field replaces them", () => {
    const spread = promptIdentifierQuoter({ ...POSTGRES_DIALECT, displayName: "Amazon Redshift" });
    expect(spread("order")).toBe('"order"');
    const replaced = promptIdentifierQuoter({ ...POSTGRES_DIALECT, reservedWords: ["widget"] });
    expect([replaced("widget"), replaced("order")]).toEqual(['"widget"', "order"]);
  });

  it("an id that is no built-in engine quotes with identifierQuote", () => {
    const quote = promptIdentifierQuoter({ id: "redshift" as DialectSpec["id"], identifierQuote: '"', reservedWords: ["order"] });
    expect([quote("order"), quote("order line"), quote("Post")]).toEqual(['"order"', '"order line"', "Post"]);
  });
});
