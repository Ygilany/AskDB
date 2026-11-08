import { describe, expect, it } from "vitest";
import type { NormalizedSchema } from "@askdb/core";
import { classifyResult } from "./classify.js";

const kinds = (result: ReturnType<typeof classifyResult>) =>
  Object.fromEntries(result.shape.columns.map((c) => [c.name, c.kind]));

describe("classifyResult", () => {
  it("classifies from names alone", () => {
    const result = classifyResult({
      columns: [
        { name: "customer_id" },
        { name: "orderId" },
        { name: "fiscal_year" },
        { name: "created_at" },
        { name: "order_month" },
        { name: "total_revenue" },
        { name: "unit_price" },
        { name: "conversion_rate" },
        { name: "market_share" },
        { name: "order_count" },
        { name: "region" },
      ],
      rowCount: 10,
    });
    expect(kinds(result)).toEqual({
      customer_id: "identifier",
      orderId: "identifier",
      fiscal_year: "year",
      created_at: "date",
      order_month: "date",
      total_revenue: "currency",
      unit_price: "currency",
      conversion_rate: "percent",
      market_share: "percent",
      order_count: "measure",
      region: "category",
    });
  });

  it("doesn't read a word that merely ends in 'id' as an identifier", () => {
    const result = classifyResult({ columns: [{ name: "paid" }, { name: "valid" }], rowCount: 2 });
    expect(kinds(result)).toEqual({ paid: "category", valid: "category" });
  });

  it("uses the column's database type", () => {
    const result = classifyResult({
      columns: [
        { name: "placed", type: "timestamp with time zone" },
        { name: "orders", type: "bigint" },
        { name: "balance", type: "money" },
        { name: "label", type: "text" },
        { name: "amount", type: "varchar(20)" },
      ],
      rowCount: 3,
    });
    expect(kinds(result)).toEqual({
      placed: "date",
      orders: "measure",
      balance: "currency",
      label: "category",
      // A text column named like money is still text: it can't be plotted as a number.
      amount: "category",
    });
  });

  it("takes a column's type from the schema artifact when exactly one schema column has its name", () => {
    const schema: NormalizedSchema = {
      tables: [
        { name: "orders", columns: [{ name: "placed", type: "date", nullable: false, primaryKey: false }, { name: "n", type: "integer", nullable: false, primaryKey: false }, { name: "code", type: "integer", nullable: false, primaryKey: false }] },
        { name: "shipments", columns: [{ name: "code", type: "text", nullable: false, primaryKey: false }] },
      ],
    };
    const result = classifyResult({ columns: [{ name: "placed" }, { name: "n" }, { name: "code" }], rowCount: 4, schema });
    // `placed` and `n` say nothing by name; their schema types decide. `code` matches two schema
    // columns, so the schema doesn't decide it, and its name reads as a category.
    expect(kinds(result)).toEqual({ placed: "date", n: "measure", code: "category" });
  });

  it("doesn't read a quantity per unit of time as a year or a date", () => {
    const result = classifyResult({
      columns: [{ name: "revenue_per_year", type: "numeric" }, { name: "orders_per_day" }, { name: "avg_response_time" }],
      rowCount: 2,
      rows: [
        { revenue_per_year: 10, orders_per_day: 4, avg_response_time: 3.2 },
        { revenue_per_year: 12, orders_per_day: 5, avg_response_time: 2.9 },
      ],
    });
    expect(kinds(result)).toEqual({ revenue_per_year: "currency", orders_per_day: "measure", avg_response_time: "measure" });
  });

  it("checks values locally and keeps what it learns out of the shape", () => {
    const rows = [
      { label: "North America and Caribbean", delta: -3, n: "12", day: "2026-01-05" },
      { label: "Europe", delta: 4, n: "7", day: "2026-01-06" },
    ];
    const result = classifyResult({
      columns: [{ name: "label" }, { name: "delta" }, { name: "n" }, { name: "day_bucket" }],
      rowCount: 2,
      rows,
    });
    expect(kinds(result)).toEqual({ label: "category", delta: "measure", n: "measure", day_bucket: "date" });
    expect(result.local.delta).toMatchObject({ hasNegative: true });
    expect(result.local.label).toMatchObject({ distinctCount: 2, maxLabelLength: 27 });
    expect(JSON.stringify(result.shape)).not.toMatch(/North America|Europe|-3|2026/);
  });

  it("reads ISO date strings and Date values as dates, and array rows by position", () => {
    const result = classifyResult({
      columns: [{ name: "bucket" }, { name: "at" }],
      rowCount: 2,
      rows: [
        ["2026-01", new Date("2026-01-01")],
        ["2026-02", new Date("2026-02-01")],
      ],
    });
    expect(kinds(result)).toEqual({ bucket: "date", at: "date" });
  });

  it("carries the row count and the truncated flag", () => {
    const result = classifyResult({ columns: [{ name: "x" }], rowCount: 500, truncated: true });
    expect(result.shape).toMatchObject({ rowCount: 500, truncated: true });
  });
});
