import { describe, expect, it } from "vitest";
import { classifyResult } from "./classify.js";
import type { ChartSpec, ClassifyResultInput } from "./types.js";
import { validateChartSpec } from "./validate.js";

const byRegion = (overrides: Partial<ClassifyResultInput> = {}) =>
  classifyResult({
    columns: [{ name: "region" }, { name: "order_count", type: "bigint" }, { name: "avg_order_value", type: "numeric" }, { name: "return_rate", type: "numeric" }],
    rowCount: 4,
    ...overrides,
  });

const spec = (s: Partial<ChartSpec>): ChartSpec => ({
  type: "bar",
  category: "region",
  series: ["order_count"],
  title: "Orders by region",
  description: "Order count for each region.",
  ...s,
});

const codes = (r: ReturnType<typeof validateChartSpec>) => (r.ok ? [] : r.issues.map((i) => i.code));

describe("validateChartSpec", () => {
  it("accepts a spec whose columns exist and whose series are measures", () => {
    expect(validateChartSpec(spec({}), byRegion())).toEqual({ ok: true });
  });

  it("refuses a column the result doesn't have", () => {
    expect(codes(validateChartSpec(spec({ series: ["revenue"] }), byRegion()))).toEqual(["UNKNOWN_COLUMN"]);
    expect(codes(validateChartSpec(spec({ category: "country" }), byRegion()))).toEqual(["UNKNOWN_COLUMN"]);
  });

  it("refuses a series that isn't a measure: identifiers and years are categories", () => {
    const result = classifyResult({ columns: [{ name: "fiscal_year" }, { name: "customer_id" }, { name: "revenue" }], rowCount: 5 });
    expect(codes(validateChartSpec(spec({ type: "line", category: "fiscal_year", series: ["customer_id"] }), result))).toEqual(["SERIES_NOT_MEASURE"]);
    expect(codes(validateChartSpec(spec({ type: "bar", category: "customer_id", series: ["fiscal_year"] }), result))).toEqual(["SERIES_NOT_MEASURE"]);
    expect(codes(validateChartSpec(spec({ series: [] }), byRegion()))).toEqual(["SERIES_NOT_MEASURE"]);
  });

  it("needs a category that isn't a measure for every chart but a metric", () => {
    expect(codes(validateChartSpec(spec({ category: undefined }), byRegion()))).toEqual(["INVALID_CATEGORY"]);
    expect(codes(validateChartSpec(spec({ category: "avg_order_value" }), byRegion()))).toEqual(["INVALID_CATEGORY"]);
  });

  it("allows a metric only for one row and one series", () => {
    const one = classifyResult({ columns: [{ name: "total_revenue", type: "numeric" }], rowCount: 1 });
    expect(validateChartSpec(spec({ type: "metric", category: undefined, series: ["total_revenue"] }), one)).toEqual({ ok: true });
    expect(codes(validateChartSpec(spec({ type: "metric", category: undefined }), byRegion()))).toEqual(["METRIC_NOT_SCALAR"]);
    const twoSeries = classifyResult({ columns: [{ name: "a", type: "int" }, { name: "b", type: "int" }], rowCount: 1 });
    expect(codes(validateChartSpec(spec({ type: "metric", category: undefined, series: ["a", "b"] }), twoSeries))).toEqual(["METRIC_NOT_SCALAR"]);
  });

  describe("part-to-whole policy", () => {
    const pie = (s: Partial<ChartSpec> = {}) => spec({ type: "pie", ...s });

    it("accepts an additive count or total across 2–8 categories", () => {
      expect(validateChartSpec(pie(), byRegion())).toEqual({ ok: true });
      expect(validateChartSpec(pie(), byRegion({ rowCount: 2 }))).toEqual({ ok: true });
      expect(validateChartSpec(pie(), byRegion({ rowCount: 8 }))).toEqual({ ok: true });
    });

    it.each([
      ["one category", pie(), byRegion({ rowCount: 1 })],
      ["nine categories", pie(), byRegion({ rowCount: 9 })],
      ["an average", pie({ series: ["avg_order_value"] }), byRegion()],
      ["a rate", pie({ series: ["return_rate"] }), byRegion()],
      ["several series", pie({ series: ["order_count", "avg_order_value"] }), byRegion()],
      ["a truncated result", pie(), byRegion({ truncated: true })],
    ])("refuses %s", (_label, s, result) => {
      expect(codes(validateChartSpec(s, result))).toContain("PIE_NOT_PART_TO_WHOLE");
    });

    it("refuses a time series", () => {
      const result = classifyResult({ columns: [{ name: "order_month" }, { name: "order_count", type: "int" }], rowCount: 4 });
      expect(codes(validateChartSpec(pie({ category: "order_month" }), result))).toContain("PIE_NOT_PART_TO_WHOLE");
    });

    it("refuses negative values the host found locally", () => {
      const result = classifyResult({
        columns: [{ name: "region" }, { name: "net_total", type: "numeric" }],
        rowCount: 3,
        rows: [{ region: "a", net_total: 5 }, { region: "b", net_total: -2 }, { region: "c", net_total: 1 }],
      });
      expect(codes(validateChartSpec(pie({ series: ["net_total"] }), result))).toContain("PIE_NOT_PART_TO_WHOLE");
    });

    it("refuses a category that repeats across rows", () => {
      const result = classifyResult({
        columns: [{ name: "region" }, { name: "order_count", type: "int" }],
        rowCount: 3,
        rows: [{ region: "a", order_count: 1 }, { region: "a", order_count: 2 }, { region: "b", order_count: 3 }],
      });
      expect(codes(validateChartSpec(pie(), result))).toContain("PIE_NOT_PART_TO_WHOLE");
    });

    it("refuses a ranking question", () => {
      expect(codes(validateChartSpec(pie(), byRegion(), { question: "Top 5 regions by orders" }))).toContain("PIE_NOT_PART_TO_WHOLE");
    });
  });
});
