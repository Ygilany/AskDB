import { describe, expect, it } from "vitest";
import { SqlValidationError, type SqlValidationRuleCode } from "../errors.js";
import {
  BUILT_IN_DIALECTS,
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
  it("returns the SQL trimmed, keeping a trailing semicolon as the model wrote it", () => {
    expect(validateSelectSql(POSTGRES_DIALECT, "  SELECT 1 as one;\n")).toBe("SELECT 1 as one;");
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 1 as one ;")).toBe("SELECT 1 as one ;");
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 1 as one")).toBe("SELECT 1 as one");
  });

  it("runs the dialect's extraValidate on the statement without its trailing semicolon", () => {
    const seen: string[] = [];
    const dialect: DialectSpec = { ...POSTGRES_DIALECT, extraValidate: (sql) => void seen.push(sql) };
    validateSelectSql(dialect, "SELECT 1 as one ;");
    expect(seen).toEqual(["SELECT 1 as one"]);
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
    // Multi-statement SQL also matches the hook. Base checks must reject it as
    // SQL_MULTI_STATEMENT; SQL_FORBIDDEN_KEYWORD would mean extraValidate ran first.
    expectRule("SELECT * FROM users; SELECT 1", "SQL_MULTI_STATEMENT", noStarSelect);
  });
});

describe("buildSelectGuardrailExplanation", () => {
  it("summarizes validated SELECT shape", () => {
    const sql = validateSelectSql(POSTGRES_DIALECT, "SELECT 1 AS x");
    const ex = buildSelectGuardrailExplanation(sql);
    expect(ex.statementKind).toBe("select");
    expect(ex.checksVerified).toContain("single_statement");
    expect(ex.checksVerified).toContain("no_locking_reads");
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

// T-SQL runs a batch without `;` between statements. Each row was accepted before #327
// and SQL Server runs it as more than one statement (or as control flow around one).
describe("validateSelectSql — sql server statements without ';'", () => {
  it.each([
    [`SELECT 1 SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 IF 1=1 SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 WHILE 1=1 SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 l: SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 DECLARE c CURSOR FOR SELECT 1 OPEN c`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 BEGIN TRY SELECT 1/0 END TRY BEGIN CATCH SELECT 2 END CATCH`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 RETURN`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 GOTO l`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 DECLARE @x int`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 PRINT 1`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 RAISERROR('x',16,1)`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 THROW 50000, 'x', 1`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 BEGIN TRAN`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 SAVE TRAN x`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 BEGIN DISTRIBUTED TRANSACTION`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 WHILE 1=1 BREAK`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 WHILE 1=1 CONTINUE`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 OPEN c`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 CLOSE c`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 DEALLOCATE c`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 ADD SIGNATURE TO p BY CERTIFICATE c`, "SQL_FORBIDDEN_KEYWORD"],
    [`SELECT 1 READTEXT t.c @ptr 0 10`, "SQL_FORBIDDEN_KEYWORD"],
    // A parenthesized query right after a complete expression starts a statement.
    [`SELECT 1 (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT 'a' (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT @@ROWCOUNT (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`(SELECT 1) (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 OPTION (MAXDOP 1) (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT name FROM sys.objects WHERE name IN (name) ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT name FROM sys.objects ORDER BY name OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 AS n (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 AS n ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    // An unqualified quoted name is a column, not a function.
    [`SELECT name FROM sys.objects ORDER BY [name] ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT name FROM sys.objects ORDER BY "name" ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    // Reserved words that end a value are no function name.
    [`SELECT NULL ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT CURRENT_TIMESTAMP ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT CASE WHEN 1=1 THEN 1 END ((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    // Keywords SQL Server does not reserve are aliases outside their clause.
    [`SELECT 1 offset (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 next (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 first (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 apply (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 zone (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 ties (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    // Only a keyword, an operator, a comma or a TOP count may come before a subquery.
    [`SELECT {d '2020-01-01'} (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT $ (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    // Studio binds `?` as `@p0`, a value.
    [`SELECT ? (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    // A sort column named offset is no OFFSET clause.
    [`SELECT 1 AS offset ORDER BY offset (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    // SQL Server ends these literals where a keyword starts, so the keyword is a token.
    [`SELECT 0xSELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1ESELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT $1SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT \u20acSELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1\u200bSELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1\u0085SELECT 2`, "SQL_MULTI_STATEMENT"],
    // Code outside strings and quoted names must be plain, since SQL Server may split
    // statements at anything else: U+FEFF continues a name there, `$ .5` is money.
    [`SELECT 1 a\ufeffunion SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a\ufefffrom (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT $ . (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT \\. (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT $ .x((SELECT 2))`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 + \u20ac . (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 AS a\u00a0b`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1x AS a`, "SQL_MULTI_STATEMENT"],
    // …and inside a name or a variable, where it ends the token.
    [`SELECT 1 a\u00a0SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a\u200bSELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT @@spid\u3000SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a\u2028PRINT 'x'`, "SQL_MULTI_STATEMENT"],
    // After a leading WITH list's main query, and before a trailing `;`.
    [`WITH x AS (SELECT 1 a) SELECT a FROM x SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`WITH x AS (SELECT 1 a) SELECT a FROM x (SELECT 2)`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 SELECT 2;`, "SQL_MULTI_STATEMENT"],
    // A label is a statement; the lexer reads `l:SELECT` as a `:SELECT` parameter.
    [`SELECT 1 l:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 l:(SELECT 2)`, "SQL_MULTI_STATEMENT"],
    // `@`, `$` and `#` continue a SQL Server name, so `a@b:` is a label too.
    [`SELECT 1 a@b:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a@b:DELETE FROM t`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a$b:SELECT 2`, "SQL_MULTI_STATEMENT"],
    // Studio binds `?` as `@p0`, which would extend the name before it.
    [`SELECT 1 x?:SELECT 2`, "SQL_MULTI_STATEMENT"],
    // A `:` written against anything but `(`, a comma or an operator is a label,
    // whatever the name looks like (`#`, `#@` and `#1#` are names to SQL Server).
    [`SELECT 1 #:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 AS a #@:DELETE FROM t`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 #1#:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 #$a:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT (1):SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 1:SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1 a.:SELECT 2`, "SQL_MULTI_STATEMENT"],
    // ASCII control characters are not plain code.
    [`SELECT 1\x00SELECT 2`, "SQL_MULTI_STATEMENT"],
    [`SELECT 1\x7fSELECT 2`, "SQL_MULTI_STATEMENT"],
  ] as const)("rejects %s as %s", (sql, rule) => {
    expectRule(sql, rule, SQLSERVER_DIALECT);
  });
});

// A locking read holds row or table locks until the host's transaction ends, so other
// writers and lockers wait (#319). Every engine rejects every form under one rule.
describe("validateSelectSql — locking reads", () => {
  it.each([
    ["postgres", `SELECT id FROM orders WHERE id = 1 FOR SHARE`],
    ["postgres", `SELECT id FROM orders WHERE id = 1 FOR UPDATE`],
    ["postgres", `SELECT id FROM orders WHERE id = 1 FOR NO KEY UPDATE`],
    ["postgres", `SELECT o.id FROM orders o WHERE o.id = 1 FOR KEY SHARE OF o SKIP LOCKED`],
    ["postgres", `SELECT * FROM (SELECT id FROM orders WHERE id = 1 FOR UPDATE) s`],
    ["postgres", `WITH s AS (SELECT id FROM orders WHERE id = 1 for Share) SELECT * FROM s`],
    ["mysql", `SELECT id FROM orders WHERE id = 1 FOR UPDATE SKIP LOCKED`],
    ["mysql", `SELECT id FROM orders WHERE id = 1 FOR SHARE NOWAIT`],
    ["mysql", `SELECT id FROM orders WHERE id = 1 LOCK IN SHARE MODE`],
    ["mariadb", `SELECT * FROM (SELECT id FROM orders WHERE id = 1 lock in share mode) s`],
    ["sqlite", `SELECT id FROM orders WHERE id = 1 FOR UPDATE`],
    // T-SQL lock hints, inside WITH (…), beside a hint that takes no lock, and without WITH.
    ...["UPDLOCK", "XLOCK", "HOLDLOCK", "PAGLOCK", "TABLOCK", "TABLOCKX", "ROWLOCK", "SERIALIZABLE", "REPEATABLEREAD"].map(
      (hint) => ["sqlserver", `SELECT id FROM orders WITH (${hint}) WHERE id = 1`] as const,
    ),
    ["sqlserver", `SELECT id FROM orders WITH (READPAST, UPDLOCK) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders (UPDLOCK) WHERE id = 1`],
    ["sqlserver", `SELECT o.id FROM orders AS o (holdlock) WHERE o.id = 1`],
    // SQL Server also reads a quoted hint alone in parentheses right after a table name as a hint.
    ["sqlserver", `SELECT id FROM orders ([UPDLOCK]) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM [dbo].[orders]( "holdlock" ) WHERE id = 1`],
    // It ignores trailing spaces when it compares a quoted name.
    ["sqlserver", `SELECT id FROM orders ([UPDLOCK ]) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders ("HOLDLOCK   ") WHERE id = 1`],
    // And at any depth of parentheses.
    ["sqlserver", `SELECT id FROM orders (([UPDLOCK])) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM [dbo].[orders] ( ( ( "xlock " ) ) ) WHERE id = 1`],
    // SQL Server compares hint names loosely (`ʟ` reads as L), so an unquoted name must be printable ASCII.
    ["sqlserver", `SELECT id FROM orders WITH (UPDʟOCK) WHERE id = 1`],
    ["sqlserver", `SELECT Größe FROM orders`],
    // So must a quoted name alone in parentheses after a name, where SQL Server reads a hint.
    ["sqlserver", `SELECT id FROM orders ([UPDLOCK\uFEFF]) WHERE id = 1`],
    ["sqlserver", `SELECT COUNT([Größe]) AS n FROM orders`],
    ["sqlserver", `SELECT COUNT([rowlock]) AS n FROM orders`],
    // Including a one-name column list, which can't be qualified: name the column inside the query.
    ["sqlserver", `WITH [集計] ([合計]) AS (SELECT 1) SELECT [合計] FROM [集計]`],
  ] as const)("rejects on %s: %s", (id, sql) => {
    expectRule(sql, "SQL_LOCKING_READ", BUILT_IN_DIALECTS[id]);
  });

  // Reads that take no lock past the statement, other FOR clauses, and the words as names.
  it.each([
    ["postgres", `SELECT SUBSTRING('abcdef' FROM 1 FOR 3) AS s`],
    ["postgres", `SELECT x.share, x.updlock, x.holdlock FROM (SELECT 1 AS share, 2 AS updlock, 3 AS holdlock) x`],
    ["mysql", `SELECT jt.n, SUBSTRING('abcdef' FROM 1 FOR 3) AS s FROM JSON_TABLE('[1,2]', '$[*]' COLUMNS (n FOR ORDINALITY)) AS jt`],
    ["sqlserver", `SELECT id FROM orders WITH (READUNCOMMITTED) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders WITH (READPAST) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders WITH (READCOMMITTEDLOCK) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders WITH (NOWAIT) WHERE id = 1`],
    ["sqlserver", `SELECT id FROM orders WHERE id = 1 FOR JSON PATH`],
    ["sqlserver", `SELECT id FROM orders FOR SYSTEM_TIME AS OF '2026-01-01' WHERE id = 1`],
    ["sqlserver", `SELECT 1 AS [updlock], 2 AS "holdlock", N'FOR SHARE WITH (UPDLOCK)' AS s`],
    ["sqlserver", `SELECT COUNT(o.[rowlock]) AS n, MAX([updlock] + 1) AS m, MAX(([xlock]) + 1) AS x FROM orders o ([NOLOCK])`],
    ["sqlserver", `SELECT o.[Größe], N'佐藤 花子' AS name, COUNT(o.[Größe]) AS n FROM orders o GROUP BY o.[Größe]`],
  ] as const)("accepts on %s: %s", (id, sql) => {
    expect(validateSelectSql(BUILT_IN_DIALECTS[id], sql)).toBe(sql);
  });

  // Stripping trailing spaces from a quoted name once took time quadratic in the run of spaces
  // (about 10 s here). An absolute bound with a wide margin, not a ratio (#657).
  it("checks an 80 KB quoted name alone in parentheses on SQL Server in under 1 s", () => {
    const sql = `SELECT id FROM orders ([${" ".repeat(80_000)}x])`;
    const start = performance.now();
    expect(validateSelectSql(BUILT_IN_DIALECTS.sqlserver, sql)).toBe(sql);
    expect(performance.now() - start).toBeLessThan(1000);
  }, 30_000);
});

describe("validateSelectSql — sequence writers (#825)", () => {
  const unknownId = { ...POSTGRES_DIALECT, id: "x" as DialectSpec["id"] };
  // MariaDB advances or sets a sequence from a SELECT, outside the transaction's rollback.
  // MySQL has no sequences, so the MySQL-family dialects refuse these on both ids.
  it.each(["mysql", "mariadb"] as const)("on %s, refuses NEXTVAL(), SETVAL() and NEXT VALUE FOR", (id) => {
    const dialect = BUILT_IN_DIALECTS[id];
    for (const sql of [
      `SELECT NEXTVAL(s)`,
      `SELECT nextval (app.s) AS id`,
      `SELECT \`NEXTVAL\`(s)`,
      `SELECT SETVAL(s, 100)`,
      `SELECT setval(s, 100, 0, 1)`,
      `SELECT NEXT VALUE FOR s`,
      `SELECT id FROM orders WHERE id > (SELECT next value for app.s)`,
    ]) {
      expectRule(sql, "SQL_FORBIDDEN_FUNCTION", dialect);
    }
  });

  // T-SQL has the same NEXT VALUE FOR; Postgres and SQLite don't parse it, so every lexer refuses it.
  it.each([
    ["sqlserver", SQLSERVER_DIALECT],
    ["postgres", POSTGRES_DIALECT],
    ["sqlite", SQLITE_DIALECT],
    ["an id that is no built-in engine", unknownId],
  ] as const)("on %s, refuses NEXT VALUE FOR", (_name, dialect) => {
    expectRule(`SELECT NEXT VALUE FOR dbo.s`, "SQL_FORBIDDEN_FUNCTION", dialect);
  });

  // The hint names a read-only alternative only where the engine has it.
  it.each([
    ["mariadb", BUILT_IN_DIALECTS.mariadb, "PREVIOUS VALUE FOR"],
    ["sqlserver", SQLSERVER_DIALECT, "sys.sequences"],
  ] as const)("on %s, the NEXT VALUE FOR hint names that engine's reader", (_name, dialect, reader) => {
    const hint = (() => {
      try {
        validateSelectSql(dialect, `SELECT NEXT VALUE FOR s`);
      } catch (e) {
        return (e as SqlValidationError).hint;
      }
      return expect.fail("expected SqlValidationError");
    })();
    expect(hint).toContain(reader);
    if (reader === "sys.sequences") expect(hint).not.toContain("PREVIOUS VALUE FOR");
  });

  // The readers only return the session's last value, so they stay allowed, and so does a column
  // or alias that is only named like a writer.
  it.each(["mysql", "mariadb"] as const)("on %s, accepts LASTVAL(), PREVIOUS VALUE FOR and columns named like the writers", (id) => {
    const dialect = BUILT_IN_DIALECTS[id];
    for (const sql of [
      `SELECT LASTVAL(s)`,
      `SELECT PREVIOUS VALUE FOR s`,
      `SELECT nextval, setval FROM counters`,
      `SELECT c.nextval AS next_value FROM counters c WHERE c.setval > 0`,
      `SELECT id AS next, total AS value FROM orders`,
      // Quoted names aren't the keywords, even side by side.
      "SELECT `next` `value` `for` FROM t",
    ]) {
      expect(validateSelectSql(dialect, sql)).toBe(sql);
    }
  });
});

describe("validateSelectSql — Unicode-escaped identifiers (#692)", () => {
  it("rejects a denylisted function written as a U& identifier", () => {
    // Postgres 17 runs this as set_config: the escapes hide the name from the denylist.
    expectRule(`SELECT U&"set\\005fconfig"('app.agency_id', '2', true)`, "SQL_UNICODE_ESCAPED_IDENTIFIER");
  });

  // Each of these ran on Postgres 17.11 (read-only transaction, rolled back).
  it.each([
    ["a UESCAPE clause", `SELECT U&"set!005fconfig" UESCAPE '!'('app.agency_id', '2', true)`],
    ["a lower-case u", `SELECT u&"set\\005fconfig"('app.agency_id', '2', true)`],
    ["a schema-qualified name", `SELECT pg_catalog.U&"set\\005fconfig"('app.agency_id', '2', true)`],
    ["the six-digit escape", `SELECT U&"set\\+00005Fconfig"('app.agency_id', '2', true)`],
    ["another blocked function", `SELECT U&"pg\\005fsleep"(10)`],
    ["a column name, not a call", `SELECT U&"s\\0073n" FROM people.person`],
    // #704: Postgres reads it as orders, and it returned both tenants' rows.
    ["a table name", `SELECT id FROM U&"\\006Frders"`],
    // `:U` lexes as a parameter, but Postgres reads the `:` as the slice separator.
    ["a name right after a slice's `:`", `SELECT (ARRAY[1,2,3])[1:U&"set\\005fconfig"('app.agency_id', '2', true)::int] AS x`],
  ])("rejects %s", (_label, sql) => {
    expectRule(sql, "SQL_UNICODE_ESCAPED_IDENTIFIER");
  });

  it("rejects a blocked function written right after a slice's `:`", () => {
    // Postgres 17 ran set_config here: `:set_config` lexes as one parameter token.
    expectRule(`SELECT (ARRAY[1,2,3])[1:set_config('app.agency_id', '2', true)::int] AS x`, "SQL_FORBIDDEN_FUNCTION");
  });

  it("rejects it on CockroachDB and on a dialect id that is no built-in engine", () => {
    const sql = `SELECT U&"set\\005fconfig"('app.agency_id', '2', true)`;
    expectRule(sql, "SQL_UNICODE_ESCAPED_IDENTIFIER", BUILT_IN_DIALECTS.cockroachdb);
    expectRule(sql, "SQL_UNICODE_ESCAPED_IDENTIFIER", { ...POSTGRES_DIALECT, id: "legacy-engine" } as unknown as DialectSpec);
  });

  it("accepts the & operator, a U& string, and the same text on engines without U& names", () => {
    // With a space on either side of `&`, Postgres reads the `&` operator.
    for (const operator of [`SELECT u & "x" FROM t`, `SELECT u& "x" FROM t`, `SELECT u &"x" FROM t`]) {
      expect(validateSelectSql(POSTGRES_DIALECT, operator)).toBe(operator);
    }
    // A tenant placeholder still reads as one.
    const placeholder = `SELECT id FROM orders WHERE agency_id = :tenant_agency_ids`;
    expect(validateSelectSql(POSTGRES_DIALECT, placeholder)).toBe(placeholder);
    const unicodeString = `SELECT U&'\\0041' AS a`;
    expect(validateSelectSql(POSTGRES_DIALECT, unicodeString)).toBe(unicodeString);
    // SQLite reads it as `u` AND the column "x".
    const sqliteAnd = `SELECT u&"x" FROM t`;
    expect(validateSelectSql(SQLITE_DIALECT, sqliteAnd)).toBe(sqliteAnd);
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

  it.each([
    [`SELECT 1 ATTACH 'x' AS o`],
    [`SELECT 1 PRAGMA table_info(t)`],
  ])("rejects %s as a sqlite forbidden keyword", (sql) => {
    expectRule(sql, "SQL_FORBIDDEN_KEYWORD", SQLITE_DIALECT);
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
    [`/*!50000 SELECT 1`, MYSQL_DIALECT],
    [`SELECT [abc`, SQLSERVER_DIALECT],
  ] as const)("rejects %s", (sql, dialect) => {
    expectRule(sql, "SQL_UNTERMINATED", dialect);
  });
});

describe("validateSelectSql — string continued after E'…' (#703)", () => {
  // Postgres joins E'a' and the next '…' across a newline and keeps escape mode, so it reads
  // `a'` and then code; AskDB read three closed strings and passed it.
  const bypass = "SELECT E'a'\n'\\'' AS x, o.* FROM orders o --'";

  it.each([
    ["the bypass", bypass],
    ["a lower-case e", "SELECT e'a'\n'\\'' AS x FROM orders --'"],
    ["a -- comment in the gap", "SELECT E'a' -- note\n'b' AS x"],
    ["a /* */ comment in the gap", "SELECT E'a' /* note */\n'b' AS x"],
    ["a newline inside a /* */ comment in the gap", "SELECT E'a' /* one\ntwo */ 'b' AS x"],
    ["a third string", "SELECT 'a'\n'b' || E'c'\n\n'd' AS x"],
    // A `:` glued to the E used to lex as a `:E` placeholder, hiding the E-string (#709 review).
    ["a JSON_OBJECT key's `:` before the E", "SELECT JSON_OBJECT('k':E'a'\n'\\'' || (SELECT count(*) FROM orders o)::text --'\n) AS x"],
    ["an array slice's `:` before the E", "SELECT (ARRAY[1,2])[1:E'1'\n'\\''::int] AS x --'"],
  ])("rejects %s", (_label, sql) => {
    expectRule(sql, "SQL_STRING_CONTINUATION");
  });

  it("names the string's position, not its text, which may hold a value from the question", () => {
    try {
      validateSelectSql(POSTGRES_DIALECT, "SELECT E'Jane Doe'\n'x' AS a");
      expect.fail("expected SqlValidationError");
    } catch (e) {
      expect((e as SqlValidationError).message).toContain("offset 7");
      expect((e as SqlValidationError).message).not.toContain("Jane");
    }
  });

  it("rejects it on CockroachDB and on a dialect id that is no built-in engine", () => {
    expectRule(bypass, "SQL_STRING_CONTINUATION", BUILT_IN_DIALECTS.cockroachdb);
    expectRule(bypass, "SQL_STRING_CONTINUATION", { ...POSTGRES_DIALECT, id: "legacy-engine" } as unknown as DialectSpec);
  });

  it("accepts strings that keep the same reading", () => {
    // A plain string continued on the next line reads the same either way, and so does a
    // continuation joined with `||` or written on one line.
    for (const sql of ["SELECT 'a'\n'b' AS x", "SELECT E'a' || 'b' AS x", "SELECT E'a'\n|| 'b' AS x", "SELECT E'a\\nb' AS x"]) {
      expect(validateSelectSql(POSTGRES_DIALECT, sql), JSON.stringify(sql)).toBe(sql);
    }
    // MySQL has no E'…' strings: `E` is a column there.
    const mysql = "SELECT E 'a'\n, 'b' AS x FROM t";
    expect(validateSelectSql(MYSQL_DIALECT, mysql)).toBe(mysql);
  });
});

describe("validateSelectSql — CockroachDB b'…' byte strings (#730)", () => {
  // CockroachDB reads b'…' with backslash escapes, so it reads the bytes `'` and then an unscoped
  // read of orders; AskDB read one string and passed it.
  const bypass = String.raw`SELECT b'\'' AS x, o.* FROM orders o --'`;
  const cockroach = BUILT_IN_DIALECTS.cockroachdb;
  const custom = { ...POSTGRES_DIALECT, id: "legacy-engine" } as unknown as DialectSpec;

  it.each([
    ["the bypass", bypass],
    // CockroachDB keeps the escape mode across a continuation.
    ["a continued b'…' string", "SELECT b'a'\n'\\'' AS x, o.* FROM orders o --'"],
    ["a b'…' string after a slice's `:`", String.raw`SELECT (ARRAY[1,2])[1:b'\''] AS x, o.* FROM orders o --'`],
  ])("rejects %s on CockroachDB, Postgres and a dialect id that is no built-in engine", (_label, sql) => {
    for (const dialect of [cockroach, POSTGRES_DIALECT, custom]) {
      expectRule(sql, "SQL_ESCAPED_BYTE_STRING", dialect);
    }
  });

  it("names the string's position, not its text, which may hold a value from the question", () => {
    try {
      validateSelectSql(cockroach, String.raw`SELECT b'Jane\x20Doe' AS a`);
      expect.fail("expected SqlValidationError");
    } catch (e) {
      expect((e as SqlValidationError).message).toContain("offset 7");
      expect((e as SqlValidationError).message).not.toContain("Jane");
    }
  });

  it("accepts byte and bit strings that keep the same reading", () => {
    // No backslash and no continuation: both readings end the string at the same quote. A B'…'
    // bit string and an x'…' hex string have no escapes on either engine.
    for (const sql of ["SELECT b'abc' AS x", "SELECT b'it''s' AS x", "SELECT B'01'\n'10' AS x", "SELECT x'0a' AS x", "SELECT b'0101' AS x"]) {
      expect(validateSelectSql(cockroach, sql), JSON.stringify(sql)).toBe(sql);
      expect(validateSelectSql(POSTGRES_DIALECT, sql), JSON.stringify(sql)).toBe(sql);
    }
    // MySQL's b'…' is a bit-value literal, read without escapes.
    expect(validateSelectSql(MYSQL_DIALECT, "SELECT b'0101' AS x")).toBe("SELECT b'0101' AS x");
  });

  it("refuses a continued lower-case bit string on postgres too, the decided cost", () => {
    // Postgres reads b'01' + newline + '10' as one bit string, but a host may point the postgres
    // dialect at CockroachDB, which would read it with escapes. Refused there too (ADR 0012, #730).
    expectRule("SELECT b'01'\n'10' AS x", "SQL_ESCAPED_BYTE_STRING", POSTGRES_DIALECT);
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

  // Each statement returned one result set on SQL Server 2022 (#327), except the last
  // two rows, whose `:name` placeholders AskDB binds before the SQL runs.
  it.each([
    [`SELECT 1 AS id UNION ALL SELECT 2 EXCEPT SELECT 3 INTERSECT SELECT 4`],
    [`WITH x AS (SELECT 1 AS a), y (b) AS (SELECT 2) SELECT a, b FROM x CROSS JOIN y`],
    [`WITH XMLNAMESPACES ('urn:x' AS ns) SELECT 1 AS [ns:a] FOR XML PATH('r')`],
    [`SELECT CASE WHEN 1=1 THEN 'a' ELSE 'b' END AS v`],
    // Subqueries after a keyword, an operator, a comma, or a function's bracket.
    [`SELECT 1 AS a, (SELECT 2) AS b`],
    [`SELECT 1 AS v WHERE 2 > (SELECT 1)`],
    [`SELECT 1 AS v WHERE 1 = (SELECT 1)`],
    [`SELECT 1 AS v WHERE 1 < (SELECT 2)`],
    [`SELECT 1 + (SELECT 2) AS v`],
    [`SELECT 1 AS a WHERE (SELECT 1) = 1 OR NOT (SELECT 1) = 0 OR 'a' LIKE (SELECT 'a') EXCEPT (SELECT 2) INTERSECT (SELECT 3)`],
    [`SELECT CASE WHEN (SELECT 1) = 1 THEN 1 END AS v`],
    [`SELECT 1 AS v WHERE 5 % (SELECT 2) = 1`],
    [`SELECT ~(SELECT 2) AS v`],
    [`SELECT 1 - (SELECT 2) AS v`],
    [`SELECT 2 * (SELECT 2) / (SELECT 1) AS v`],
    [`SELECT 1 & (SELECT 1) | (SELECT 2) ^ (SELECT 3) AS v`],
    [`SELECT 1 AS v WHERE EXISTS (SELECT 1) AND NOT EXISTS (SELECT 2 WHERE 1=0) OR 1 IN (SELECT 1)`],
    [`SELECT 1 AS v WHERE 1 = ANY (SELECT 1) AND 1 = SOME (SELECT 1) AND 1 >= ALL (SELECT 1)`],
    [`SELECT 1 AS v WHERE 1 BETWEEN (SELECT 0) AND (SELECT 2)`],
    [`SELECT 1 AS v WHERE 'a' LIKE 'a' ESCAPE (SELECT '!')`],
    [`SELECT 1 AS a WHERE 1 IS DISTINCT FROM (SELECT 2)`],
    [`SELECT CASE (SELECT 1) WHEN 1 THEN (SELECT 2) ELSE (SELECT 3) END AS v`],
    [`SELECT DISTINCT (SELECT 1) AS a`],
    [`SELECT o.name FROM sys.objects o JOIN (SELECT 1 a) x ON (SELECT 1) = 1`],
    [`SELECT o.name FROM sys.objects o CROSS APPLY (SELECT 1 AS a) x OUTER APPLY (SELECT 2 AS b) y`],
    [`SELECT COUNT(*) AS c FROM sys.objects HAVING (SELECT 1) = 1`],
    [`SELECT name FROM sys.objects ORDER BY (SELECT NULL)`],
    [`SELECT name FROM sys.objects ORDER BY name OFFSET (SELECT 0) ROWS FETCH NEXT (SELECT 1) ROWS ONLY`],
    [`SELECT name FROM sys.objects ORDER BY name OFFSET 0 ROWS FETCH FIRST (SELECT 1) ROWS ONLY`],
    [`SELECT 1 AS offset ORDER BY offset OFFSET (SELECT 0) ROWS`],
    [`SELECT SYSDATETIMEOFFSET() AT TIME ZONE (SELECT 'UTC') AS z`],
    // Any text in strings and quoted names, and money with digits. An unquoted name must be ASCII (#319).
    [`SELECT N'caf\u00e9 \u20ac\u00a0' AS [n\u00e9e \u2028], 1 AS [\u00e9t\u00e9], $5.00 AS m`],
    [`SELECT 1 AS a, ((SELECT 1)) AS b`],
    [`SELECT 1 AS a WHERE 1 IN ((SELECT 1))`],
    [`SELECT COALESCE((SELECT 1), 0) AS v`],
    [`SELECT CAST((SELECT 1) AS int) AS v`],
    [`SELECT LEFT((SELECT 'abc'), 1) AS l, RIGHT((SELECT 'abc'), 1) AS r, NULLIF((SELECT 1), 0) AS n`],
    [`SELECT 1 AS a@b, 2 AS c$d`],
    [`SELECT sys.fn_varbintohexstr((SELECT 0x01)) AS h`],
    [`SELECT [sys].[fn_varbintohexstr]((SELECT 0x01)) AS h`],
    [`SELECT geography::Point((SELECT 47.6), -122.3, 4326).Lat AS lat`],
    [`SELECT TOP 5 ABS((SELECT 1)) AS v FROM sys.objects`],
    [`SELECT TOP (SELECT 5) name FROM sys.objects`],
    [`SELECT TOP 5 (SELECT 1) AS a FROM sys.objects`],
    [`SELECT TOP (5) (SELECT 1) AS a`],
    [`SELECT TOP 5 PERCENT (SELECT 1) AS a FROM sys.objects`],
    [`SELECT TOP 5 WITH TIES (SELECT 1) AS a FROM sys.objects ORDER BY name`],
    [`(SELECT 1 AS a) UNION (SELECT 2)`],
    [`SELECT 1 AS a UNION ALL (SELECT 2)`],
    [`WITH x AS (SELECT 1 a) (SELECT a FROM x)`],
    [`SELECT o.name FROM sys.objects o WITH (NOLOCK)`],
    // A colon that is no label: `::` and AskDB's `:name` placeholders.
    [`SELECT geography::Point(47.6, -122.3, 4326).STAsText() AS p`],
    [`SELECT id FROM t WHERE org_id IN (:tenant_org_ids) AND id = :id`],
    [`SELECT id FROM t WHERE a=:id AND b>=:lo AND c+:d>1 AND e IN (1,:f)`],
  ])("accepts the single SQL Server statement %s", (sql) => {
    accept(SQLSERVER_DIALECT, sql);
  });

  it("allows exactly one trailing semicolon", () => {
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 1;  ")).toBe("SELECT 1;");
    expectRule("SELECT 1;;", "SQL_MULTI_STATEMENT");
    expectRule("SELECT 1; SELECT 2;", "SQL_MULTI_STATEMENT");
  });
});

describe("validateSelectSql — unknown dialect ids lex conservatively", () => {
  const legacy = { ...POSTGRES_DIALECT, id: "legacy-engine" } as unknown as DialectSpec;

  it("rejects SQL that any built-in dialect would read as a write", () => {
    // MySQL treats \' as an escaped quote, so this is a DROP after a closed string.
    // Postgres (and the other non-MySQL lexers) keep the quote open and accept it.
    const mysqlOnlyWrite = `SELECT 'a\\' AS x, '; DROP TABLE t; SELECT 'b\\' c'`;
    expectRejected(mysqlOnlyWrite, legacy);
    expect(validateSelectSql(POSTGRES_DIALECT, mysqlOnlyWrite)).toBe(mysqlOnlyWrite);
    expectRejected(`SELECT 1 WAITFOR DELAY '00:10'`, legacy);
    // SQL Server reads it as two statements.
    expectRule(`SELECT 1 SELECT 2`, "SQL_MULTI_STATEMENT", legacy);
    // SQL Server reads it as a locking read.
    expectRule(`SELECT id FROM orders WITH (UPDLOCK)`, "SQL_LOCKING_READ", legacy);
  });

  it("still accepts ordinary SQL", () => {
    expect(validateSelectSql(legacy, "SELECT id FROM t WHERE x = 'a'")).toBe(
      "SELECT id FROM t WHERE x = 'a'",
    );
    const materialized = "WITH x AS MATERIALIZED (SELECT 1 AS a) SELECT a FROM x";
    // AskDB binds an unknown id's parameters as $1, $2 (`markerStyleForDialect`).
    const dollarParams = "SELECT id FROM t WHERE id = $1 AND org IN ($2, $3)";
    expect(validateSelectSql(legacy, dollarParams)).toBe(dollarParams);
    expect(validateSelectSql(legacy, materialized)).toBe(materialized);
  });
});
