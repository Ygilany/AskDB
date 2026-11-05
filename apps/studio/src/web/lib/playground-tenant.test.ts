import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_SQL_MODE } from "@askdb/core";
import { historyTenant, historyTenantParams, PLAYGROUND_DEFAULT_TENANT_SQL_MODE } from "./playground-tenant";

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
  // Twelve params, so a save or replay that orders keys as text ("10" before "2") fails.
  it("replays a sql-params result's tenant params as saved, in marker order", () => {
    const params = Array.from({ length: 12 }, (_, i) => `agency-${i + 1}`);
    expect(historyTenant({ sqlMode: "sql-params", tenantParams: historyTenantParams(params) })).toEqual({
      enabled: true,
      sqlMode: "sql-params",
      bindings: [],
      params,
    });
  });

  it("saves and replays no tenant params for a result without any (sql-only)", () => {
    expect(historyTenantParams([])).toBeUndefined();
    expect(historyTenant({ sqlMode: "sql-only", tenantParams: historyTenantParams([]) })).toBeNull();
  });
});
