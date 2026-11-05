import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_SQL_MODE } from "@askdb/core";
import { historyTenant, PLAYGROUND_DEFAULT_TENANT_SQL_MODE } from "./playground-tenant";

describe("Playground tenant SQL mode", () => {
  // The browser bundle can't import core's constant, so the Playground keeps a copy:
  // it must start in the mode a host gets by default (ADR 0024).
  it("starts in core's DEFAULT_TENANT_SQL_MODE", () => {
    expect(PLAYGROUND_DEFAULT_TENANT_SQL_MODE).toBe(DEFAULT_TENANT_SQL_MODE);
  });
});

describe("historyTenant", () => {
  // A replayed sql-params entry holds marker SQL; Execute needs the tenant params it was
  // saved with, in marker order, or every driver refuses the statement.
  it("rebuilds a sql-params entry's tenant params in marker order", () => {
    expect(historyTenant({ sqlMode: "sql-params", tenantParams: { "1": "42", "2": "7" } })).toEqual({
      enabled: true,
      sqlMode: "sql-params",
      bindings: [],
      params: ["42", "7"],
    });
  });

  it("has no tenant params for an entry saved without any (sql-only)", () => {
    expect(historyTenant({ sqlMode: "sql-only" })).toBeNull();
  });
});
