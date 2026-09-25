import { describe, expect, it } from "vitest";
import { SqlValidationError, type SqlValidationRuleCode } from "../errors.js";
import {
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  type DialectSpec,
} from "./dialect-spec.js";
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

// ---------------------------------------------------------------------------
// Dialect-aware lexing regressions. Each SQL string below was accepted by the
// previous quote-stripping validator; every one must now be rejected.
// ---------------------------------------------------------------------------

function expectRejected(sql: string, dialect: DialectSpec): void {
  expect(() => validateSelectSql(dialect, sql), sql).toThrow(SqlValidationError);
}

describe("validateSelectSql — verified bypasses (postgres)", () => {
  it.each([
    // E'' strings use backslash escapes, so the literal is E'\'' and the CTE after it is code.
    [`WITH a AS (SELECT E'\\''), d AS (DELETE FROM orders RETURNING 1) SELECT 'x'`],
    // Postgres "…" identifiers have no backslash escape.
    [`WITH "x\\" AS (SELECT 1), d AS (DELETE FROM orders RETURNING 1) SELECT 1 AS "y"`],
    // A dollar-quoted string only closes on the exact opening tag.
    [`SELECT $$ $ $$, 1; DELETE FROM t; SELECT $$ $ $$`],
    // [ is an array subscript in Postgres, not a bracket identifier.
    [`SELECT ARRAY['a]'], 1; DELETE FROM t; SELECT ']'`],
    [`SELECT * INTO stolen FROM orders`],
    [`SELECT set_config('default_transaction_read_only','off',false)`],
    [`SELECT dblink_exec('x','DELETE FROM t')`],
    [`SELECT pg_terminate_backend(1)`],
    [`SELECT lo_export(1,'/tmp/x')`],
    [`SELECT lo_import('/etc/passwd')`],
    [`SELECT pg_sleep(1000)`],
    [`SELECT pg_read_file('/etc/passwd')`],
    [`SELECT pg_catalog.pg_sleep(1)`],
    [`SELECT "pg_sleep"(1)`],
  ])("rejects %s", (sql) => {
    expectRejected(sql, POSTGRES_DIALECT);
  });
});

describe("validateSelectSql — verified bypasses (mysql)", () => {
  it.each([
    [`SELECT '\\'', 1; DROP TABLE t; SELECT 'x'`],
    [`SELECT "\\"", 1; DROP TABLE t; SELECT "x"`],
    [`SELECT 1 # '\n; DROP TABLE t; SELECT '1'`],
    [`SELECT * FROM t INTO OUTFILE '/tmp/x'`],
    [`SELECT * FROM t INTO DUMPFILE '/tmp/x'`],
    [`SELECT LOAD_FILE('/etc/passwd')`],
    [`SELECT SLEEP(100)`],
    [`SELECT BENCHMARK(1000000, MD5('x'))`],
    [`SELECT 1 /*! ; DROP TABLE t */`],
  ])("rejects %s", (sql) => {
    expectRejected(sql, MYSQL_DIALECT);
  });
});

describe("validateSelectSql — verified bypasses (sql server)", () => {
  it.each([
    [`SELECT 1 SHUTDOWN WITH NOWAIT`],
    [`SELECT 1 WAITFOR DELAY '00:10'`],
    [`SELECT * FROM OPENDATASOURCE('x','y').a.b.c`],
    [`SELECT * INTO stolen FROM orders`],
    [`SELECT 1 KILL 52`],
    [`SELECT 1 BACKUP DATABASE x TO DISK = 'y'`],
    [`SELECT 1 RESTORE DATABASE x FROM DISK = 'y'`],
    [`SELECT 1 DBCC CHECKDB`],
    [`SELECT 1 RECONFIGURE`],
    [`SELECT 1 DENY SELECT ON t TO u`],
    [`SELECT * FROM t BULK INSERT t FROM 'x'`],
    [`SELECT 1 USE master`],
    [`SELECT 1 EXEC xp_cmdshell 'dir'`],
    [`SELECT 1 EXECUTE sp_configure 'x', 1`],
    [`SELECT 1 SET IDENTITY_INSERT t ON`],
    [`SELECT 1 DISABLE TRIGGER trg ON t`],
    [`SELECT [a]]b], 1; DELETE FROM t`],
  ])("rejects %s", (sql) => {
    expectRejected(sql, SQLSERVER_DIALECT);
  });
});

describe("validateSelectSql — sqlite", () => {
  it.each([
    [`SELECT load_extension('x')`],
    [`SELECT writefile('/tmp/x', 'y')`],
    [`SELECT * INTO t2 FROM t`],
  ])("rejects %s", (sql) => {
    expectRejected(sql, SQLITE_DIALECT);
  });
});

describe("validateSelectSql — unterminated tokens fail closed", () => {
  it.each([
    [`SELECT 'abc`, POSTGRES_DIALECT],
    [`SELECT "abc`, POSTGRES_DIALECT],
    [`SELECT $tag$ abc $other$`, POSTGRES_DIALECT],
    [`SELECT E'abc\\'`, POSTGRES_DIALECT],
    [`SELECT 1 /* abc`, POSTGRES_DIALECT],
    [`SELECT 'abc\\'`, MYSQL_DIALECT],
    [`SELECT \`abc`, MYSQL_DIALECT],
    [`SELECT [abc`, SQLSERVER_DIALECT],
  ] as const)("rejects %s", (sql, dialect) => {
    expectRule(sql, "SQL_UNTERMINATED", dialect);
  });
});

describe("validateSelectSql — legitimate SQL still accepted", () => {
  const accept = (dialect: DialectSpec, sql: string) => {
    expect(validateSelectSql(dialect, sql)).toBe(sql);
  };

  it("keeps keywords and semicolons inside string literals", () => {
    accept(POSTGRES_DIALECT, `SELECT id FROM notes WHERE note = 'delete me; drop'`);
    accept(MYSQL_DIALECT, `SELECT id FROM notes WHERE note = 'it\\'s; drop table'`);
    accept(SQLSERVER_DIALECT, `SELECT id FROM notes WHERE note = N'delete; shutdown'`);
    accept(SQLITE_DIALECT, `SELECT id FROM notes WHERE note = 'pragma; attach'`);
  });

  it("keeps keywords and semicolons inside quoted identifiers", () => {
    accept(POSTGRES_DIALECT, `SELECT "delete;me", "into" FROM "drop"`);
    accept(MYSQL_DIALECT, "SELECT `delete`, `into` FROM `drop;table`");
    accept(SQLSERVER_DIALECT, `SELECT [delete], [a]]b] FROM [drop;table]`);
    accept(SQLITE_DIALECT, "SELECT [delete], `into`, \"drop\" FROM t");
  });

  it("accepts Postgres E-strings, dollar quotes, casts, arrays and JSON operators", () => {
    accept(POSTGRES_DIALECT, `SELECT E'it\\'s; delete' AS s`);
    accept(POSTGRES_DIALECT, `SELECT $body$ delete; drop $ $$ $body$ AS s`);
    accept(POSTGRES_DIALECT, `SELECT created_at::date, (ARRAY['a]', 'b'])[1] FROM t`);
    accept(POSTGRES_DIALECT, `SELECT data -> 'a', data ->> 'b', data #> '{a,b}', data #>> '{c}' FROM t`);
    accept(POSTGRES_DIALECT, `SELECT 'C:\\' AS path FROM t`);
    accept(POSTGRES_DIALECT, `SELECT id FROM users WHERE id = $1 AND org = ANY($2)`);
  });

  it("accepts window functions and CTEs", () => {
    accept(
      POSTGRES_DIALECT,
      `WITH recent AS (SELECT id, total FROM orders) SELECT id, ROW_NUMBER() OVER (PARTITION BY id ORDER BY total DESC) FROM recent`,
    );
    accept(POSTGRES_DIALECT, `(SELECT 1) UNION ALL (SELECT 2)`);
  });

  it("matches blocked keywords on whole tokens, not substrings", () => {
    accept(
      POSTGRES_DIALECT,
      `SELECT created_into, updated_at, description, copy_count, deleted_at, into_x FROM t`,
    );
    accept(MYSQL_DIALECT, `SELECT sleep_minutes, load_file_id FROM t`);
    // A column named like a blocked function is fine when it is not called.
    accept(MYSQL_DIALECT, `SELECT sleep FROM health`);
  });

  it("treats MySQL -- and # comments as comments", () => {
    expectRule(`SELECT 1 -- x`, "SQL_COMMENT", MYSQL_DIALECT);
    expectRule(`SELECT 1 # x`, "SQL_COMMENT", MYSQL_DIALECT);
  });

  it("does not treat # as a comment in Postgres", () => {
    accept(POSTGRES_DIALECT, `SELECT 5 # 3 AS xor_value`);
  });

  it("accepts SQL Server temp tables, variables and N'' strings", () => {
    accept(SQLSERVER_DIALECT, `SELECT TOP (10) * FROM #recent WHERE id = @p0 AND name = N'x'`);
  });

  it("allows exactly one trailing semicolon", () => {
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 1;  ")).toBe("SELECT 1");
    expectRule("SELECT 1;;", "SQL_MULTI_STATEMENT");
  });
});

describe("validateSelectSql — unknown dialect ids lex conservatively", () => {
  const legacy = { ...POSTGRES_DIALECT, id: "legacy-engine" } as unknown as DialectSpec;

  it("rejects SQL that any built-in dialect would read as a write", () => {
    expectRejected(`SELECT '\\'', 1; DROP TABLE t; SELECT 'x'`, legacy);
    expectRejected(`SELECT 1 WAITFOR DELAY '00:10'`, legacy);
  });

  it("still accepts ordinary SQL", () => {
    expect(validateSelectSql(legacy, "SELECT id FROM t WHERE x = 'a'")).toBe(
      "SELECT id FROM t WHERE x = 'a'",
    );
  });
});
