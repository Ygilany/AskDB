import { describe, expect, it } from "vitest";
import { QueryParameterError } from "../errors.js";
import {
  bindPreparedQuery,
  escapeSqlLiteral,
  scanPlaceholders,
  stripSqlStringLiterals,
  tokenizeSqlSpans,
  type PreparedQuery,
} from "./bind.js";
import { validateSelectSql } from "./validate.js";
import { MYSQL_DIALECT, POSTGRES_DIALECT, SQLITE_DIALECT, SQLSERVER_DIALECT } from "./dialect-spec.js";

describe("tokenizeSqlSpans / stripSqlStringLiterals", () => {
  it("leaves code outside quotes intact", () => {
    expect(stripSqlStringLiterals("SELECT id FROM users")).toBe("SELECT id FROM users");
  });

  it("strips single-quoted strings", () => {
    expect(stripSqlStringLiterals("SELECT 'a''b' FROM t")).toBe("SELECT '' FROM t");
  });

  it("strips double-quoted identifiers", () => {
    expect(stripSqlStringLiterals('SELECT "Weird Name" FROM t')).toBe("SELECT \"\" FROM t");
  });

  it("strips backticks and brackets", () => {
    expect(stripSqlStringLiterals("SELECT `col` FROM [tbl]")).toBe("SELECT `` FROM []");
  });

  it("does not treat $1 as a dollar-quoted string", () => {
    const sql = "SELECT id FROM users WHERE id = $1";
    expect(stripSqlStringLiterals(sql)).toBe(sql);
    expect(validateSelectSql(POSTGRES_DIALECT, sql)).toBe(sql);
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

describe("validateSelectSql still works after tokenizer extraction", () => {
  it("rejects multi-statement and accepts WITH", () => {
    expect(() => validateSelectSql(SQLITE_DIALECT, "SELECT 1; SELECT 2")).toThrow();
    expect(validateSelectSql(SQLSERVER_DIALECT, "WITH c AS (SELECT 1 AS n) SELECT n FROM c")).toContain("WITH");
  });

  it("ignores keywords inside strings", () => {
    expect(validateSelectSql(POSTGRES_DIALECT, "SELECT 'delete' AS x")).toBe("SELECT 'delete' AS x");
  });
});

describe("tokenizeSqlSpans coverage", () => {
  it("returns code and quoted spans", () => {
    const spans = tokenizeSqlSpans("SELECT 'x' FROM t");
    expect(spans.some((s) => s.kind === "quoted")).toBe(true);
    expect(spans.some((s) => s.kind === "code")).toBe(true);
  });
});
