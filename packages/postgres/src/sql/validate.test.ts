import { describe, expect, it } from "vitest";
import type { SqlValidationRuleCode } from "@askdb/core";
import { SqlValidationError } from "@askdb/core";
import {
  buildPostgresSelectGuardrailExplanation,
  validatePostgresSelectSql,
} from "./validate.js";

function expectRule(sql: string, rule: SqlValidationRuleCode): void {
  try {
    validatePostgresSelectSql(sql);
    expect.fail("expected SqlValidationError");
  } catch (e) {
    expect(e).toBeInstanceOf(SqlValidationError);
    const err = e as SqlValidationError;
    expect(err.rule).toBe(rule);
    expect(err.hint).toBeTruthy();
  }
}

describe("validatePostgresSelectSql", () => {
  it("accepts SELECT and strips trailing semicolon", () => {
    expect(validatePostgresSelectSql("SELECT 1 as one;")).toBe("SELECT 1 as one");
  });

  it("accepts WITH ... SELECT", () => {
    const sql = "WITH c AS (SELECT 1 AS n) SELECT n FROM c";
    expect(validatePostgresSelectSql(sql)).toBe(sql);
  });

  it("rejects empty sql", () => {
    expectRule("   ", "SQL_EMPTY");
  });

  it("rejects multi-statement payloads", () => {
    expectRule("SELECT 1; SELECT 2", "SQL_MULTI_STATEMENT");
  });

  it("rejects statements that do not start with SELECT or WITH", () => {
    expectRule("INSERT INTO users SELECT 1", "SQL_NOT_SELECT_OR_WITH");
    expectRule("DROP TABLE users", "SQL_NOT_SELECT_OR_WITH");
  });

  it("rejects forbidden keywords even when the statement begins with SELECT", () => {
    expectRule("SELECT delete FROM users", "SQL_FORBIDDEN_KEYWORD");
    expectRule("SELECT drop FROM users", "SQL_FORBIDDEN_KEYWORD");
  });

  it("rejects inline comments", () => {
    expectRule("SELECT 1 --boom", "SQL_COMMENT");
  });

  it("allows benign column names that contain substring 'delete'", () => {
    const sql = `SELECT deleted_at FROM users`;
    expect(validatePostgresSelectSql(sql)).toBe(sql);
  });

});

describe("buildPostgresSelectGuardrailExplanation", () => {
  it("summarizes validated SELECT shape", () => {
    const sql = validatePostgresSelectSql("SELECT 1 AS x");
    const ex = buildPostgresSelectGuardrailExplanation(sql);
    expect(ex.statementKind).toBe("select");
    expect(ex.checksVerified).toContain("single_statement");
    expect(ex.remediationNote.length).toBeGreaterThan(10);
  });
});
