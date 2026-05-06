import { describe, expect, it } from "vitest";
import { SqlValidationError } from "../errors.js";
import { validatePostgresSelectSql } from "./validate.js";

describe("validatePostgresSelectSql", () => {
  it("accepts SELECT and strips trailing semicolon", () => {
    expect(validatePostgresSelectSql("SELECT 1 as one;")).toBe("SELECT 1 as one");
  });

  it("accepts WITH ... SELECT", () => {
    const sql = "WITH c AS (SELECT 1 AS n) SELECT n FROM c";
    expect(validatePostgresSelectSql(sql)).toBe(sql);
  });

  it("rejects empty sql", () => {
    expect(() => validatePostgresSelectSql("   ")).toThrow(SqlValidationError);
  });

  it("rejects multi-statement payloads", () => {
    expect(() => validatePostgresSelectSql("SELECT 1; SELECT 2")).toThrow(SqlValidationError);
  });

  it("rejects DDL/DML-ish keywords", () => {
    expect(() => validatePostgresSelectSql("INSERT INTO users SELECT 1")).toThrow(SqlValidationError);
    expect(() => validatePostgresSelectSql("DROP TABLE users")).toThrow(SqlValidationError);
  });

  it("rejects inline comments", () => {
    expect(() => validatePostgresSelectSql("SELECT 1 --boom")).toThrow(SqlValidationError);
  });

  it("allows benign column names that contain substring 'delete'", () => {
    const sql = `SELECT deleted_at FROM users`;
    expect(validatePostgresSelectSql(sql)).toBe(sql);
  });
});
