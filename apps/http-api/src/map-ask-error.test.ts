import { SensitiveReferenceError, TenantGuardrailError, TenantScopeError } from "@askdb/core";
import { describe, expect, it } from "vitest";
import { mapAskError } from "./server.js";

// The server can't raise either guardrail error today (warn-mode sensitive check, no tenant
// scope), so no request reaches these branches; this pins the documented 422 shape directly.
const ctx = { timedOut: false, timeoutMs: 60_000 };

/** A plain Error carrying another class's name, as a duplicated copy of @askdb/core would throw. */
function foreignCopy(name: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error("from another copy of @askdb/core"), { name }, fields);
}

describe("mapAskError — guardrail_violation", () => {
  it("maps SensitiveReferenceError to 422 guardrail_violation with its rule", () => {
    const e = new SensitiveReferenceError("reads a sensitive column", "SENSITIVE_COLUMN_REFERENCED", []);
    expect(mapAskError(e, ctx)).toEqual({
      status: 422,
      error: { code: "guardrail_violation", message: "reads a sensitive column", rule: "SENSITIVE_COLUMN_REFERENCED" },
    });
  });

  it("maps TenantGuardrailError to 422 guardrail_violation with the first warning's rule", () => {
    const e = new TenantGuardrailError("not scoped", [
      { rule: "MISSING_TENANT_PREDICATE", tableId: "table:public.orders", message: "no tenant filter" },
      { rule: "UNPROVABLE_SCOPE", tableId: "table:public.users", message: "can't prove scope" },
    ]);
    expect(mapAskError(e, ctx)).toEqual({
      status: 422,
      error: { code: "guardrail_violation", message: "not scoped", rule: "MISSING_TENANT_PREDICATE" },
    });
  });

  it("classifies by name when the error comes from another copy of @askdb/core", () => {
    const sensitive = foreignCopy("SensitiveReferenceError", { rule: "SENSITIVE_TABLE_REFERENCED" });
    expect(mapAskError(sensitive, ctx)).toMatchObject({
      status: 422,
      error: { code: "guardrail_violation", rule: "SENSITIVE_TABLE_REFERENCED" },
    });
    const tenant = foreignCopy("TenantGuardrailError", { warnings: [{ rule: "MISSING_TENANT_PREDICATE" }] });
    expect(mapAskError(tenant, ctx)).toMatchObject({
      status: 422,
      error: { code: "guardrail_violation", rule: "MISSING_TENANT_PREDICATE" },
    });
  });

  it("maps an error with any other name to a generic 500 internal_error", () => {
    expect(mapAskError(foreignCopy("SomethingElse", { rule: "SENSITIVE_TABLE_REFERENCED" }), ctx)).toEqual({
      status: 500,
      error: { code: "internal_error", message: "Internal server error. See server logs for this correlationId." },
    });
  });
});

// #716: only a missing scope gets its own code. The server never passes a scope (#343), so any
// other reason means something it doesn't expect, and stays a generic 500 with nothing leaked.
describe("mapAskError — tenant scope", () => {
  it("maps a missing scope to 500 tenant_scope_not_configured, and any other reason to the generic 500", () => {
    const missing = mapAskError(new TenantScopeError("no scope for table:public.agencies", "MISSING_SCOPE"), ctx);
    expect(missing).toMatchObject({ status: 500, error: { code: "tenant_scope_not_configured" } });
    expect(missing.error.message).not.toContain("table:public.agencies");
    expect(mapAskError(new TenantScopeError("unknown root table:public.x", "UNKNOWN_TENANT_ROOT"), ctx)).toEqual({
      status: 500,
      error: { code: "internal_error", message: "Internal server error. See server logs for this correlationId." },
    });
  });
});
