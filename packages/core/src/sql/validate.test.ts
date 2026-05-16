import { describe, expect, it } from "vitest";
import { SqlValidationError, type SqlValidationRuleCode } from "../errors.js";
import { POSTGRES_DIALECT, type DialectSpec } from "./dialect-spec.js";
import {
  buildSelectGuardrailExplanation,
  validateSelectSql,
} from "./validate.js";

function expectRule(sql: string, rule: SqlValidationRuleCode, dialect: DialectSpec = POSTGRES_DIALECT): void {
  try {
    validateSelectSql(dialect, sql);
    expect.fail("expected SqlValidationError");
  } catch (e) {
    expect(e).toBeInstanceOf(SqlValidationError);
    const err = e as SqlValidationError;
    expect(err.rule).toBe(rule);
    expect(err.hint).toBeTruthy();
  }
}

describe("validateSelectSql (postgres dialect)", () => {
  it("accepts SELECT and strips trailing semicolon", () => {
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 1 as one;")).toBe("SELECT 1 as one");
  });

  it("accepts WITH ... SELECT", () => {
    const sql = "WITH c AS (SELECT 1 AS n) SELECT n FROM c";
    expect(validateSelectSql(POSTGRES_DIALECT, sql)).toBe(sql);
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
    expect(validateSelectSql(POSTGRES_DIALECT, sql)).toBe(sql);
  });

  it("applies dialect-specific extraForbiddenKeywords", () => {
    const strict: DialectSpec = {
      ...POSTGRES_DIALECT,
      extraForbiddenKeywords: ["lateral"],
    };
    expectRule("SELECT * FROM users, LATERAL (SELECT 1) x", "SQL_FORBIDDEN_KEYWORD", strict);
  });

  it("runs dialect-specific extraValidate after base checks pass", () => {
    const noStarSelect: DialectSpec = {
      ...POSTGRES_DIALECT,
      extraValidate: (sql) => {
        if (/\bselect\s+\*/i.test(sql)) {
          throw new SqlValidationError(
            "SELECT * is disallowed by dialect rule",
            "SQL_FORBIDDEN_KEYWORD",
            "Enumerate the columns explicitly.",
          );
        }
      },
    };
    expect(() => validateSelectSql(noStarSelect, "SELECT * FROM users")).toThrow(SqlValidationError);
    expect(validateSelectSql(noStarSelect, "SELECT id FROM users")).toBe("SELECT id FROM users");
  });
});

describe("buildSelectGuardrailExplanation", () => {
  it("summarizes validated SELECT shape", () => {
    const sql = validateSelectSql(POSTGRES_DIALECT, "SELECT 1 AS x");
    const ex = buildSelectGuardrailExplanation(sql);
    expect(ex.statementKind).toBe("select");
    expect(ex.checksVerified).toContain("single_statement");
    expect(ex.remediationNote.length).toBeGreaterThan(10);
  });
});
