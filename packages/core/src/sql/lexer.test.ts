import { describe, expect, it } from "vitest";
import {
  GENERIC_LEXER,
  MYSQL_LEXER,
  POSTGRES_LEXER,
  SQLITE_LEXER,
  SQLSERVER_LEXER,
  lexSql,
  lexerProfileFor,
  type SqlLexerProfile,
} from "./lexer.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT } from "./dialect-spec.js";

const kinds = (sql: string, profile: SqlLexerProfile): string[] =>
  lexSql(sql, profile).map((t) => `${t.kind}:${t.text}${t.unterminated ? "!" : ""}`);

describe("lexSql", () => {
  it("splits a keyword glued to a number into its own word", () => {
    expect(kinds("SELECT 1into", POSTGRES_LEXER)).toEqual(["word:SELECT", "number:1", "word:into"]);
  });

  it("reads Postgres $1 as a parameter and $tag$ as a string", () => {
    expect(kinds("$1 $a$x$a$", POSTGRES_LEXER)).toEqual(["parameter:$1", "string:$a$x$a$"]);
  });

  it("keeps a$$ inside a Postgres identifier", () => {
    expect(kinds("a$$b", POSTGRES_LEXER)).toEqual(["word:a$$b"]);
  });

  it("nests block comments only where the engine does", () => {
    expect(kinds("/* a /* b */ c */ x", POSTGRES_LEXER)).toEqual(["comment:/* a /* b */ c */", "word:x"]);
    expect(kinds("/* a /* b */ c", SQLITE_LEXER)).toEqual(["comment:/* a /* b */", "word:c"]);
  });

  it("treats MySQL -- as a comment only before whitespace", () => {
    expect(kinds("1--1", MYSQL_LEXER)).toEqual(["number:1", "punct:-", "punct:-", "number:1"]);
    expect(kinds("1-- c", MYSQL_LEXER)).toEqual(["number:1", "comment:-- c"]);
  });

  it("lexes the body of a MySQL executable comment as code", () => {
    expect(kinds("/*!50000 DROP */", MYSQL_LEXER)).toEqual([
      "comment:/*!50000",
      "word:DROP",
      "comment:*/",
    ]);
  });

  it("reads SQL Server #temp tables, @variables, and ]] escapes", () => {
    const tokens = lexSql("#t @p0 [a]]b]", SQLSERVER_LEXER);
    expect(tokens.map((t) => t.kind)).toEqual(["word", "parameter", "quoted_identifier"]);
    expect(tokens[2]!.value).toBe("a]b");
  });

  it("reads Postgres @ as an operator", () => {
    expect(kinds("@x", POSTGRES_LEXER)).toEqual(["punct:@", "word:x"]);
  });

  it("marks unterminated tokens", () => {
    expect(kinds("'abc", GENERIC_LEXER)).toEqual(["string:'abc!"]);
    expect(kinds("/* abc", POSTGRES_LEXER)).toEqual(["comment:/* abc!"]);
  });
});

describe("lexerProfileFor", () => {
  it("maps dialect families and honours backslashEscapes", () => {
    expect(lexerProfileFor(POSTGRES_DIALECT)).toBe(POSTGRES_LEXER);
    expect(lexerProfileFor(MYSQL_DIALECT)).toBe(MYSQL_LEXER);
    expect(lexerProfileFor({ ...MYSQL_DIALECT, backslashEscapes: false })?.backslashEscapes).toBe(false);
    expect(lexerProfileFor({ ...MYSQL_DIALECT, backslashEscapes: undefined })?.backslashEscapes).toBe(true);
    expect(lexerProfileFor({ id: "unknown" } as never)).toBeUndefined();
  });
});
