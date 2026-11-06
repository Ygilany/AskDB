import { describe, expect, it } from "vitest";
import {
  GENERIC_LEXER,
  MYSQL_LEXER,
  POSTGRES_LEXER,
  SQLITE_LEXER,
  SQLSERVER_LEXER,
  findPostgresOnlyForms,
  lexSql,
  lexerProfileFor,
  type SqlLexerProfile,
} from "./lexer.js";
import { COCKROACHDB_DIALECT, MYSQL_DIALECT, POSTGRES_DIALECT, type DialectSpec } from "./dialect-spec.js";

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

  it("ends SQL Server literals and names where SQL Server does", () => {
    expect(kinds("0xSELECT 0x1F 1ESELECT 1E5 $1SELECT $5.00 $action \u20acSELECT a\u00a0b a\u200bb a\ufeffb a@b@c", SQLSERVER_LEXER)).toEqual([
      "number:0x",
      "word:SELECT",
      "number:0x1F",
      "number:1E",
      "word:SELECT",
      "number:1E5",
      "number:$1",
      "word:SELECT",
      "number:$5.00",
      "parameter:$action",
      "number:\u20ac",
      "word:SELECT",
      "word:a",
      "word:b",
      "word:a",
      "word:b",
      "word:a\ufeffb",
      "word:a@b@c",
    ]);
  });

  it.each([POSTGRES_LEXER, MYSQL_LEXER, SQLITE_LEXER, GENERIC_LEXER])("keeps $id's reading of the SQL Server forms", (profile) => {
    expect(kinds("0xSELECT 1ESELECT $1SELECT \u20acSELECT a\u00a0b", profile)).toEqual([
      "number:0",
      "word:xSELECT",
      "number:1",
      "word:ESELECT",
      "parameter:$1SELECT",
      "word:\u20acSELECT",
      "word:a\u00a0b",
    ]);
  });

  it("reads Postgres @ as an operator", () => {
    expect(kinds("@x", POSTGRES_LEXER)).toEqual(["punct:@", "word:x"]);
  });

  it("marks unterminated tokens", () => {
    expect(kinds("'abc", GENERIC_LEXER)).toEqual(["string:'abc!"]);
    expect(kinds("/* abc", POSTGRES_LEXER)).toEqual(["comment:/* abc!"]);
  });

  it("marks a MySQL executable comment that never closes", () => {
    expect(kinds("/*!50000 SELECT 1", MYSQL_LEXER)).toEqual([
      "comment:/*!50000!",
      "word:SELECT",
      "number:1",
    ]);
  });
});

describe("lexSql — a `:` before an E'…' string (#703)", () => {
  it("reads `:E'…'` as `:` and an escape string, not a `:E` placeholder", () => {
    // A JSON_OBJECT key's or an array slice's `:`; the E-string's \\' doesn't end it.
    expect(kinds(String.raw`'k':E'a\'b'`, POSTGRES_LEXER)).toEqual(["string:'k'", "punct::", String.raw`string:E'a\'b'`]);
    expect(kinds("[1:e'2']", POSTGRES_LEXER)).toEqual(["punct:[", "number:1", "punct::", "string:e'2'", "punct:]"]);
  });

  it("keeps placeholders, and `:E` where there are no E-strings", () => {
    expect(kinds(":tenant_agency_ids :e1 :E", POSTGRES_LEXER)).toEqual([
      "parameter::tenant_agency_ids",
      "parameter::e1",
      "parameter::E",
    ]);
    expect(kinds(":E'a'", MYSQL_LEXER)).toEqual(["parameter::E", "string:'a'"]);
  });
});

describe("lexSql — a `:` before a b'…' string (#730)", () => {
  it("reads `:b'…'` as `:` and a byte string, not a `:b` placeholder", () => {
    // An array slice's `:`; CockroachDB reads the b'…' string with backslash escapes, so the
    // checks must see it as one.
    expect(kinds("[1:b'a']", POSTGRES_LEXER)).toEqual(["punct:[", "number:1", "punct::", "string:b'a'", "punct:]"]);
    expect(kinds("[1:B'01']", POSTGRES_LEXER)).toEqual(["punct:[", "number:1", "punct::", "string:B'01'", "punct:]"]);
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

describe("findPostgresOnlyForms", () => {
  const custom = (backslashEscapes?: boolean) =>
    ({ id: "custom-engine", ...(backslashEscapes === undefined ? {} : { backslashEscapes }) }) as unknown as DialectSpec;
  const name = String.raw`SELECT U&"p\0061ssword" FROM t`;
  const continued = "SELECT E'a'\n'b'";
  // The U& name is code only without backslash escapes, where the ' after \ ends the string (plainOnly),
  // or only with them, where \' is a quote inside it (escapesOnly).
  const plainOnly = String.raw`SELECT 'a\' , U&"x" --'`;
  const escapesOnly = String.raw`SELECT 'a\'' , U&"x" --'`;
  type Found = { name?: string; continuation?: string; byteString?: string };

  it.each<[string, Pick<DialectSpec, "id" | "backslashEscapes"> | undefined, string, Found]>([
    ["postgres: a U& name", POSTGRES_DIALECT, name, { name: String.raw`U&"p\0061ssword"` }],
    ["postgres: a continued E-string", POSTGRES_DIALECT, continued, { continuation: "E'a'" }],
    ["cockroachdb", COCKROACHDB_DIALECT, name, { name: String.raw`U&"p\0061ssword"` }],
    ["a custom id", custom(), continued, { continuation: "E'a'" }],
    ["no dialect", undefined, name, { name: String.raw`U&"p\0061ssword"` }],
    ["mysql, which has none of the forms", MYSQL_DIALECT, `${name}; ${continued}; SELECT b'a\\b'`, {}],
    ["a custom id with backslashEscapes: the plain reading", custom(true), plainOnly, { name: 'U&"x"' }],
    ["a custom id with backslashEscapes: the escapes reading", custom(true), escapesOnly, { name: 'U&"x"' }],
    ["postgres with backslashEscapes reads only with escapes", { ...POSTGRES_DIALECT, backslashEscapes: true }, plainOnly, {}],
    // CockroachDB reads b'…' with backslash escapes, across a continuation too (#730).
    ["cockroachdb: a b'…' string with a backslash", COCKROACHDB_DIALECT, String.raw`SELECT b'a\b' AS x`, { byteString: String.raw`b'a\b'` }],
    ["cockroachdb: a continued b'…' string", COCKROACHDB_DIALECT, "SELECT b'a'\n'b' AS x", { byteString: "b'a'" }],
    ["cockroachdb: a b'…' string after a slice's `:`", COCKROACHDB_DIALECT, String.raw`SELECT a[1:b'\x01'] AS x`, { byteString: String.raw`b'\x01'` }],
    ["postgres, which a host may point at CockroachDB", POSTGRES_DIALECT, String.raw`SELECT b'a\b' AS x`, { byteString: String.raw`b'a\b'` }],
    ["no dialect: a b'…' string", undefined, String.raw`SELECT b'a\b' AS x`, { byteString: String.raw`b'a\b'` }],
    ["cockroachdb: a b'…' string that reads the same either way", COCKROACHDB_DIALECT, "SELECT b'abc', b'it''s' AS x", {}],
    ["cockroachdb: a B'…' bit string, read without escapes", COCKROACHDB_DIALECT, "SELECT B'01'\n'10' AS x", {}],
  ])("%s", (_label, dialect, sql, expected) => {
    const forms = findPostgresOnlyForms(sql, dialect);
    expect({
      name: forms.unicodeEscapedIdentifier,
      continuation: forms.escapeStringContinuation?.text,
      byteString: forms.escapedByteString?.text,
    }).toEqual({ name: undefined, continuation: undefined, byteString: undefined, ...expected });
  });
});
