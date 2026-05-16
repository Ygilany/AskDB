import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DIALECTS,
  COCKROACHDB_DIALECT,
  MARIADB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  SUPPORTED_DIALECT_IDS,
  getDialectSpec,
  isBuiltInDialectId,
  type DialectId,
} from "./dialect-spec.js";

describe("DialectSpec registry", () => {
  it("ships POSTGRES_DIALECT under id 'postgres'", () => {
    expect(POSTGRES_DIALECT.id).toBe("postgres");
    expect(BUILT_IN_DIALECTS.postgres).toBe(POSTGRES_DIALECT);
    expect(getDialectSpec("postgres")).toBe(POSTGRES_DIALECT);
  });

  it("ships COCKROACHDB_DIALECT that reuses Postgres syntax", () => {
    expect(COCKROACHDB_DIALECT.id).toBe("cockroachdb");
    expect(COCKROACHDB_DIALECT.promptBrief).toBe(POSTGRES_DIALECT.promptBrief);
    expect(getDialectSpec("cockroachdb")).toBe(COCKROACHDB_DIALECT);
  });

  it("ships MYSQL_DIALECT with backtick quoting and CONCAT()", () => {
    expect(MYSQL_DIALECT.id).toBe("mysql");
    expect(MYSQL_DIALECT.identifierQuote).toBe("`");
    expect(MYSQL_DIALECT.promptBrief).toMatch(/backtick/i);
    expect(MYSQL_DIALECT.promptBrief).toMatch(/CONCAT/);
    // `||` is logical OR in MySQL — the brief should flag this.
    expect(MYSQL_DIALECT.promptBrief).toMatch(/\|\|/);
    expect(getDialectSpec("mysql")).toBe(MYSQL_DIALECT);
  });

  it("ships MARIADB_DIALECT that reuses MySQL syntax", () => {
    expect(MARIADB_DIALECT.id).toBe("mariadb");
    expect(MARIADB_DIALECT.promptBrief).toBe(MYSQL_DIALECT.promptBrief);
    expect(MARIADB_DIALECT.identifierQuote).toBe("`");
    expect(getDialectSpec("mariadb")).toBe(MARIADB_DIALECT);
  });

  it("ships SQLITE_DIALECT with || concat and ATTACH/PRAGMA forbidden", () => {
    expect(SQLITE_DIALECT.id).toBe("sqlite");
    expect(SQLITE_DIALECT.identifierQuote).toBe('"');
    expect(SQLITE_DIALECT.promptBrief).toMatch(/strftime/);
    expect(SQLITE_DIALECT.promptBrief).toMatch(/dynamic typing/i);
    expect(SQLITE_DIALECT.extraForbiddenKeywords).toEqual(
      expect.arrayContaining(["attach", "detach", "pragma", "reindex"]),
    );
  });

  it("ships SQLSERVER_DIALECT with TOP/OFFSET FETCH guidance", () => {
    expect(SQLSERVER_DIALECT.id).toBe("sqlserver");
    expect(SQLSERVER_DIALECT.displayName).toMatch(/SQL Server/);
    expect(SQLSERVER_DIALECT.promptBrief).toMatch(/TOP/);
    expect(SQLSERVER_DIALECT.promptBrief).toMatch(/OFFSET .* FETCH NEXT/);
    expect(SQLSERVER_DIALECT.promptBrief).toMatch(/GETDATE/);
    expect(SQLSERVER_DIALECT.extraForbiddenKeywords).toEqual(
      expect.arrayContaining(["exec", "execute", "merge"]),
    );
  });

  it("BUILT_IN_DIALECTS covers every DialectId (exhaustive)", () => {
    const allIds: DialectId[] = [
      "postgres",
      "cockroachdb",
      "mysql",
      "mariadb",
      "sqlite",
      "sqlserver",
    ];
    for (const id of allIds) {
      expect(BUILT_IN_DIALECTS[id]).toBeDefined();
      expect(BUILT_IN_DIALECTS[id].id).toBe(id);
    }
  });

  it("isBuiltInDialectId narrows every shipped id", () => {
    for (const id of SUPPORTED_DIALECT_IDS) {
      expect(isBuiltInDialectId(id)).toBe(true);
    }
    expect(isBuiltInDialectId("not-a-dialect")).toBe(false);
    expect(isBuiltInDialectId(42)).toBe(false);
  });

  it("SUPPORTED_DIALECT_IDS enumerates all shipped specs", () => {
    expect(SUPPORTED_DIALECT_IDS).toEqual(
      expect.arrayContaining([
        "postgres",
        "cockroachdb",
        "mysql",
        "mariadb",
        "sqlite",
        "sqlserver",
      ]),
    );
    expect(SUPPORTED_DIALECT_IDS).toHaveLength(6);
  });
});
