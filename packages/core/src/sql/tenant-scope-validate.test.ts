import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TenantScopeError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import { validateTenantScope } from "./tenant-scope-validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const schema = loadSchema(multiTenantDir);
const policy = schema.tenantPolicy!;

describe("validateTenantScope", () => {
  it("passes with valid ids scope", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    expect(() => validateTenantScope(policy, scope)).not.toThrow();
  });

  it("passes with valid subtree scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "subtree",
        tenantRoot: "table:public.agencies",
        rootIds: ["42"],
        includeDescendants: true,
      },
    };
    expect(() => validateTenantScope(policy, scope)).not.toThrow();
  });

  it("passes with valid multi_root scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.clients", ids: ["99"] },
        ],
      },
    };
    expect(() => validateTenantScope(policy, scope)).not.toThrow();
  });

  it("passes with valid global scope", () => {
    const scope: TenantScope = {
      access: { kind: "global", reason: "super_admin" },
    };
    expect(() => validateTenantScope(policy, scope)).not.toThrow();
  });

  it("passes with advisory context", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      context: { role: "manager", region: "northeast" },
    };
    expect(() => validateTenantScope(policy, scope)).not.toThrow();
  });

  it("fails closed when no scope is provided", () => {
    expect(() => validateTenantScope(policy, undefined)).toThrow(TenantScopeError);
    try {
      validateTenantScope(policy, undefined);
    } catch (e) {
      expect((e as TenantScopeError).reason).toBe("MISSING_SCOPE");
    }
  });

  it("rejects unknown tenant root in ids scope", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.nonexistent", ids: ["42"] },
    };
    expect(() => validateTenantScope(policy, scope)).toThrow(TenantScopeError);
    try {
      validateTenantScope(policy, scope);
    } catch (e) {
      expect((e as TenantScopeError).reason).toBe("UNKNOWN_TENANT_ROOT");
    }
  });

  it("rejects unknown tenant root in subtree scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "subtree",
        tenantRoot: "table:public.nonexistent",
        rootIds: ["42"],
        includeDescendants: true,
      },
    };
    expect(() => validateTenantScope(policy, scope)).toThrow(TenantScopeError);
  });

  it("rejects unknown tenant root in multi_root scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.nonexistent", ids: ["99"] },
        ],
      },
    };
    expect(() => validateTenantScope(policy, scope)).toThrow(TenantScopeError);
  });
});
