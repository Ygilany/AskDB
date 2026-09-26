import { describe, expect, it } from "vitest";
import { QueryParameterError } from "../errors.js";
import {
  bindPreparedQuery,
  escapeSqlLiteral,
  scanPlaceholders,
  tokenizeSqlSpans,
  type PreparedQuery,
} from "./bind.js";
import { validateSelectSql } from "./validate.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT } from "./dialect-spec.js";

/** Render spans as `kind:text` pairs for compact assertions. */
function spansOf(sql: string, dialect?: Parameters<typeof tokenizeSqlSpans>[1]): string[] {
  return tokenizeSqlSpans(sql, dialect).map((s) => `${s.kind}:${sql.slice(s.start, s.end)}`);
}

describe("tokenizeSqlSpans", () => {
  it("leaves code outside quotes intact", () => {
    expect(spansOf("SELECT id FROM users")).toEqual(["code:SELECT id FROM users"]);
  });

  it("marks single-quoted strings with doubled-quote escapes", () => {
    expect(spansOf("SELECT 'a''b' FROM t")).toEqual(["code:SELECT ", "quoted:'a''b'", "code: FROM t"]);
  });

  it("marks double-quoted identifiers", () => {
    expect(spansOf('SELECT "Weird Name" FROM t')).toEqual([
      "code:SELECT ",
      'quoted:"Weird Name"',
      "code: FROM t",
    ]);
  });

  it("marks backticks and brackets without a dialect", () => {
    expect(spansOf("SELECT `col` FROM [tbl]")).toEqual([
      "code:SELECT ",
      "quoted:`col`",
      "code: FROM ",
      "quoted:[tbl]",
    ]);
  });

  it("does not treat $1 as a dollar-quoted string", () => {
    const sql = "SELECT id FROM users WHERE id = $1";
    expect(spansOf(sql)).toEqual([`code:${sql}`]);
    expect(validateSelectSql(POSTGRES_DIALECT, sql)).toBe(sql);
  });

  it("closes a dollar-quoted string only on the exact opening tag", () => {
    expect(spansOf("SELECT $$ $ $$, $a$ $b$ $a$ x", POSTGRES_DIALECT)).toEqual([
      "code:SELECT ",
      "quoted:$$ $ $$",
      "code:, ",
      "quoted:$a$ $b$ $a$",
      "code: x",
    ]);
  });

  it("follows the dialect's escape rules", () => {
    // Postgres: E'' strings honour backslash; "…" identifiers do not.
    expect(spansOf(`SELECT E'\\'' x, "a\\" y`, POSTGRES_DIALECT)).toEqual([
      "code:SELECT ",
      "quoted:E'\\''",
      "code: x, ",
      'quoted:"a\\"',
      "code: y",
    ]);
    // MySQL: backslash escapes in '…'; # starts a comment.
    expect(spansOf("SELECT '\\'' x # c", MYSQL_DIALECT)).toEqual([
      "code:SELECT ",
      "quoted:'\\''",
      "code: x ",
      "comment:# c",
    ]);
    // Postgres: [ is an array subscript, not a bracket identifier.
    expect(spansOf("SELECT a[1]", POSTGRES_DIALECT)).toEqual(["code:SELECT a[1]"]);
  });
});

describe("scanPlaceholders", () => {
  it("finds unquoted placeholders in source order", () => {
    const sql = "SELECT * FROM t WHERE a = :foo AND b = :bar";
    expect(scanPlaceholders(sql).map((p) => p.name)).toEqual(["foo", "bar"]);
  });

  it("does not detect a quoted ':name' marker", () => {
    const sql = "SELECT * FROM t WHERE a = ':state_name'";
    expect(scanPlaceholders(sql)).toEqual([]);
  });

  it("leaves placeholder-looking text inside every quote form untouched", () => {
    const sql =
      "SELECT ':a', \":b\", `:c`, [:d], $tag$ :e $tag$ FROM t WHERE x = :real";
    expect(scanPlaceholders(sql).map((p) => p.name)).toEqual(["real"]);
  });

  it("does not read the type in a ::cast as a placeholder", () => {
    const sql = "SELECT created_at::date FROM t WHERE d = :day";
    expect(scanPlaceholders(sql).map((p) => p.name)).toEqual(["day"]);
  });

  it("ignores placeholders inside comments", () => {
    const sql = "SELECT * FROM t WHERE a = :real -- :ghost";
    expect(scanPlaceholders(sql).map((p) => p.name)).toEqual(["real"]);
  });
});

describe("escapeSqlLiteral", () => {
  it("doubles single quotes on all dialects", () => {
    expect(escapeSqlLiteral("it's", { backslashEscapes: false })).toBe("'it''s'");
  });

  it("doubles backslashes when backslashEscapes is true", () => {
    expect(escapeSqlLiteral("\\", { backslashEscapes: true })).toBe("'\\\\'");
    expect(escapeSqlLiteral("\\", { backslashEscapes: false })).toBe("'\\'");
  });

  it("rejects NaN and Infinity", () => {
    expect(() => escapeSqlLiteral(Number.NaN, undefined)).toThrow(QueryParameterError);
    expect(() => escapeSqlLiteral(Number.POSITIVE_INFINITY, undefined)).toThrow(QueryParameterError);
  });

  it("rejects null bytes", () => {
    expect(() => escapeSqlLiteral("a\0b", undefined)).toThrow(QueryParameterError);
  });

  it("emits TRUE/FALSE for booleans", () => {
    expect(escapeSqlLiteral(true, undefined)).toBe("TRUE");
    expect(escapeSqlLiteral(false, undefined)).toBe("FALSE");
  });

  it("escapes the two-parameter injection shape under MySQL", () => {
    const a = escapeSqlLiteral("\\", MYSQL_DIALECT);
    const b = escapeSqlLiteral(" OR 1=1", MYSQL_DIALECT);
    expect(a).toBe("'\\\\'");
    expect(b).toBe("' OR 1=1'");
    // Closing quote of a is not consumed by a trailing backslash.
    expect(a.endsWith("'")).toBe(true);
    expect(a).not.toMatch(/[^']'\\'$/);
  });
});

function prepared(
  dialect: PreparedQuery["dialect"],
  namedSql: string,
  parameters: PreparedQuery["parameters"],
): PreparedQuery {
  return { version: 1, dialect, namedSql, parameters };
}

describe("bindPreparedQuery — scalars", () => {
  it("binds string/number/boolean/date/datetime for postgres", () => {
    const p = prepared("postgres", "SELECT * FROM t WHERE s = :s AND n = :n AND b = :b AND d = :d AND dt = :dt", [
      { name: "s", placeholder: ":s", type: "string", cardinality: "one", source: "question" },
      { name: "n", placeholder: ":n", type: "number", cardinality: "one", source: "question" },
      { name: "b", placeholder: ":b", type: "boolean", cardinality: "one", source: "question" },
      { name: "d", placeholder: ":d", type: "date", cardinality: "one", source: "question" },
      { name: "dt", placeholder: ":dt", type: "datetime", cardinality: "one", source: "question" },
    ]);
    const bound = bindPreparedQuery(p, {
      s: "colorado",
      n: 3,
      b: true,
      d: "2026-07-01",
      dt: "2026-07-01T12:00:00Z",
    });
    expect(bound.sql).toBe(
      "SELECT * FROM t WHERE s = 'colorado' AND n = 3 AND b = TRUE AND d = '2026-07-01' AND dt = '2026-07-01T12:00:00Z'",
    );
    expect(bound.unboundSql).toBe(
      "SELECT * FROM t WHERE s = $1 AND n = $2 AND b = $3 AND d = $4 AND dt = $5",
    );
    expect(bound.params).toEqual(["colorado", 3, true, "2026-07-01", "2026-07-01T12:00:00Z"]);
  });

  it("allocates ? markers for mysql/sqlite and @pN for sqlserver", () => {
    const base = {
      name: "s",
      placeholder: ":s",
      type: "string" as const,
      cardinality: "one" as const,
      source: "question" as const,
    };
    expect(bindPreparedQuery(prepared("mysql", "SELECT * FROM t WHERE s = :s", [base]), { s: "x" }).unboundSql).toBe(
      "SELECT * FROM t WHERE s = ?",
    );
    expect(bindPreparedQuery(prepared("sqlite", "SELECT * FROM t WHERE s = :s", [base]), { s: "x" }).unboundSql).toBe(
      "SELECT * FROM t WHERE s = ?",
    );
    expect(
      bindPreparedQuery(prepared("sqlserver", "SELECT * FROM t WHERE s = :s", [base]), { s: "x" }).unboundSql,
    ).toBe("SELECT * FROM t WHERE s = @p0");
  });

  it("allocates one marker per repeated scalar occurrence", () => {
    const p = prepared("postgres", "SELECT * FROM t WHERE a = :s OR b = :s", [
      { name: "s", placeholder: ":s", type: "string", cardinality: "one", source: "question" },
    ]);
    const bound = bindPreparedQuery(p, { s: "x" });
    expect(bound.unboundSql).toBe("SELECT * FROM t WHERE a = $1 OR b = $2");
    expect(bound.params).toEqual(["x", "x"]);
    expect(bound.bindings[0]!.markers).toEqual(["$1", "$2"]);
    expect(bound.bindings[0]!.indices).toEqual([0, 1]);
  });
});

describe("bindPreparedQuery — lists", () => {
  it("uses = ANY($1) on postgres and IN (?, ?) on mysql", () => {
    const params = [
      { name: "ids", placeholder: ":ids", type: "string" as const, cardinality: "many" as const, source: "question" as const },
    ];
    const pg = bindPreparedQuery(prepared("postgres", "SELECT * FROM t WHERE id IN (:ids)", params), {
      ids: ["a", "b"],
    });
    expect(pg.sql).toBe("SELECT * FROM t WHERE id IN ('a', 'b')");
    expect(pg.unboundSql).toBe("SELECT * FROM t WHERE id = ANY($1)");
    expect(pg.params).toEqual([["a", "b"]]);

    const my = bindPreparedQuery(prepared("mysql", "SELECT * FROM t WHERE id IN (:ids)", params), {
      ids: ["a", "b"],
    });
    expect(my.sql).toBe("SELECT * FROM t WHERE id IN ('a', 'b')");
    expect(my.unboundSql).toBe("SELECT * FROM t WHERE id IN (?, ?)");
    expect(my.params).toEqual(["a", "b"]);
  });

  it("rejects empty lists", () => {
    const p = prepared("postgres", "SELECT * FROM t WHERE id IN (:ids)", [
      { name: "ids", placeholder: ":ids", type: "string", cardinality: "many", source: "question" },
    ]);
    expect(() => bindPreparedQuery(p, { ids: [] })).toThrow(QueryParameterError);
  });

  it("rejects many-params outside list context", () => {
    const p = prepared("mysql", "SELECT * FROM t WHERE id = :ids", [
      { name: "ids", placeholder: ":ids", type: "string", cardinality: "many", source: "question" },
    ]);
    expect(() => bindPreparedQuery(p, { ids: ["a"] })).toThrow(
      expect.objectContaining({ reason: "INVALID_LIST_CONTEXT" }),
    );
  });
});

describe("bindPreparedQuery — errors", () => {
  it("throws MISSING_VALUE", () => {
    const p = prepared("postgres", "SELECT * FROM t WHERE s = :s", [
      { name: "s", placeholder: ":s", type: "string", cardinality: "one", source: "question" },
    ]);
    try {
      bindPreparedQuery(p, {});
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(QueryParameterError);
      expect((e as QueryParameterError).reason).toBe("MISSING_VALUE");
      expect((e as Error).message).not.toMatch(/colorado|secret/i);
    }
  });

  it("throws UNRESOLVED_PLACEHOLDER when declaration is missing from SQL", () => {
    const p = prepared("postgres", "SELECT 1", [
      { name: "s", placeholder: ":s", type: "string", cardinality: "one", source: "question" },
    ]);
    expect(() => bindPreparedQuery(p, { s: "x" })).toThrow(
      expect.objectContaining({ reason: "UNRESOLVED_PLACEHOLDER" }),
    );
  });

  it("throws DIALECT_UNSUPPORTED for a non-built-in dialect id", () => {
    const p = {
      ...prepared("postgres", "SELECT * FROM t WHERE s = :s", [
        { name: "s", placeholder: ":s", type: "string", cardinality: "one", source: "question" },
      ]),
      dialect: "oracle" as PreparedQuery["dialect"],
    };
    expect(() => bindPreparedQuery(p, { s: "x" })).toThrow(
      expect.objectContaining({ reason: "DIALECT_UNSUPPORTED" }),
    );
  });
});

describe("bindPreparedQuery — JSON round-trip", () => {
  it("rebinds a JSON-serialized PreparedQuery with no model involvement", () => {
    const original = prepared("postgres", "SELECT count(*) FROM cities WHERE state = :state_name", [
      {
        name: "state_name",
        placeholder: ":state_name",
        type: "string",
        cardinality: "one",
        source: "question",
      },
    ]);
    const revived = JSON.parse(JSON.stringify(original)) as PreparedQuery;
    const bound = bindPreparedQuery(revived, { state_name: "Utah" });
    expect(bound.sql).toBe("SELECT count(*) FROM cities WHERE state = 'Utah'");
    expect(bound.unboundSql).toBe("SELECT count(*) FROM cities WHERE state = $1");
    expect(bound.params).toEqual(["Utah"]);
  });
});

describe("bindPreparedQuery — right-to-left substitution", () => {
  it("substitutes correctly when later placeholders are longer", () => {
    const p = prepared("postgres", "SELECT * FROM t WHERE a = :a AND bb = :bb", [
      { name: "a", placeholder: ":a", type: "string", cardinality: "one", source: "question" },
      { name: "bb", placeholder: ":bb", type: "string", cardinality: "one", source: "question" },
    ]);
    const bound = bindPreparedQuery(p, { a: "1", bb: "22" });
    expect(bound.sql).toBe("SELECT * FROM t WHERE a = '1' AND bb = '22'");
  });
});

describe("bindPreparedQuery — escaping matrix for business values", () => {
  it("escapes trailing backslash under MySQL but not Postgres", () => {
    const params = [
      { name: "s", placeholder: ":s", type: "string" as const, cardinality: "one" as const, source: "question" as const },
    ];
    const my = bindPreparedQuery(prepared("mysql", "SELECT * FROM t WHERE s = :s", params), { s: "\\" });
    expect(my.sql).toBe("SELECT * FROM t WHERE s = '\\\\'");
    const pg = bindPreparedQuery(prepared("postgres", "SELECT * FROM t WHERE s = :s", params), { s: "\\" });
    expect(pg.sql).toBe("SELECT * FROM t WHERE s = '\\'");
  });
});
