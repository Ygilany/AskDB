import { describe, expect, it } from "vitest";
import {
  ambiguousFilterWarnings,
  buildOrderedGroups,
  byName,
  compileTableFilters,
  groupBy,
  makeColumnId,
  makeTableId,
  mapFkAction,
  rowsToRecords,
  sortedUnique,
} from "./index.js";

describe("compileTableFilters", () => {
  it("matches everything when no patterns are given", () => {
    expect(compileTableFilters(undefined)("public.anything")).toBe(true);
    expect(compileTableFilters([])("public.anything")).toBe(true);
  });

  it("supports * and ? and escapes regex metacharacters", () => {
    const match = compileTableFilters(["public.user?", "sales.*", "odd.a+b"]);
    expect(match("public.users")).toBe(true);
    expect(match("public.user")).toBe(false);
    expect(match("sales.orders.archive")).toBe(true);
    expect(match("odd.a+b")).toBe(true);
    expect(match("odd.aab")).toBe(false);
    expect(match("publicXusers")).toBe(false);
  });
});

describe("ambiguousFilterWarnings", () => {
  it("warns once per declared pattern that matches nothing, in declared order", () => {
    expect(
      ambiguousFilterWarnings(["public.nope", "public.u*", "x.*", "public.nope"], ["public.users", "public.orders"]),
    ).toEqual([
      { code: "ambiguous_filter", filter: "public.nope" },
      { code: "ambiguous_filter", filter: "x.*" },
      { code: "ambiguous_filter", filter: "public.nope" },
    ]);
  });

  it("returns [] without patterns", () => {
    expect(ambiguousFilterWarnings(undefined, [])).toEqual([]);
  });
});

describe("ids", () => {
  it("formats Schema v2 table and column ids", () => {
    expect(makeTableId("public", "users")).toBe("table:public.users");
    expect(makeColumnId("public", "users", "id")).toBe("table:public.users#id");
  });
});

describe("rowsToRecords", () => {
  it("maps positional rows to records keyed by every column", () => {
    expect(rowsToRecords({ columns: ["a", "b"], rows: [[1, 2], [3, null]] })).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: null },
    ]);
  });

  it("returns [] for an empty result even without column headers", () => {
    expect(rowsToRecords({ columns: [], rows: [] }, { expectedColumns: ["a"] })).toEqual([]);
  });

  it("copies only expected columns and tolerates extras", () => {
    expect(
      rowsToRecords({ columns: ["extra", "b", "a"], rows: [["x", 2, 1]] }, { expectedColumns: ["a", "b"] }),
    ).toEqual([{ a: 1, b: 2 }]);
  });

  it("throws with the source prefix when an expected column is missing", () => {
    expect(() =>
      rowsToRecords({ columns: ["a"], rows: [[1]] }, { expectedColumns: ["a", "b"], source: "@askdb/x" }),
    ).toThrow("@askdb/x: result is missing column 'b' (got [a])");
  });
});

describe("grouping and ordering helpers", () => {
  it("groupBy keeps first-seen key order and row order", () => {
    const grouped = groupBy([{ k: "b", v: 1 }, { k: "a", v: 2 }, { k: "b", v: 3 }], (r) => r.k);
    expect([...grouped.keys()]).toEqual(["b", "a"]);
    expect(grouped.get("b")!.map((r) => r.v)).toEqual([1, 3]);
  });

  it("buildOrderedGroups orders each group by position, drops undefined, sorts by name", () => {
    const rows = [
      { name: "uq_b", col: "y", pos: 2 },
      { name: "uq_b", col: "x", pos: 1 },
      { name: "skip", col: "z", pos: 1 },
      { name: "uq_a", col: "w", pos: 1 },
    ];
    const built = buildOrderedGroups(
      rows,
      (r) => r.name,
      (r) => r.pos,
      (name, ordered) => (name === "skip" ? undefined : { name, columns: ordered.map((r) => r.col) }),
    );
    expect(built).toEqual([
      { name: "uq_a", columns: ["w"] },
      { name: "uq_b", columns: ["x", "y"] },
    ]);
  });

  it("byName and sortedUnique use localeCompare", () => {
    expect([{ name: "b" }, { name: "a" }].sort(byName)).toEqual([{ name: "a" }, { name: "b" }]);
    expect(sortedUnique(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("mapFkAction", () => {
  it("maps SQL-standard action names case-insensitively", () => {
    expect(mapFkAction("CASCADE")).toBe("cascade");
    expect(mapFkAction("restrict")).toBe("restrict");
    expect(mapFkAction("SET NULL")).toBe("set null");
    expect(mapFkAction("Set Default")).toBe("set default");
    expect(mapFkAction("NO ACTION")).toBe("no action");
  });

  it("returns undefined for empty or unknown input", () => {
    expect(mapFkAction(null)).toBeUndefined();
    expect(mapFkAction(undefined)).toBeUndefined();
    expect(mapFkAction("")).toBeUndefined();
    expect(mapFkAction("SETNULL")).toBeUndefined();
  });
});
