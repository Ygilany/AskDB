import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "../schema/v2/loader.js";
import type { TenantScope } from "../schema/v2/tenant-policy.js";
import { buildTenantPromptBlock } from "./tenant-prompt.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");

const schema = loadSchema(multiTenantDir);
const policy = schema.tenantPolicy!;

describe("buildTenantPromptBlock", () => {
  it("includes hierarchy structure", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("Agency");
    expect(block).toContain("Sub-Agency");
    expect(block).toContain("Client");
    expect(block).toContain("top-level");
    expect(block).toContain("child of");
  });

  it("includes scoped table instructions", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("table:public.orders");
    expect(block).toContain("agency_id");
    expect(block).toContain("owning_agency");
  });

  it("includes inherited scope join paths", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("table:public.appointments");
    expect(block).toContain("join path");
  });

  it("includes polymorphic table instructions", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("table:public.notes");
    expect(block).toContain("owner_type");
    expect(block).toContain("owner_id");
    expect(block).toContain("type discriminator");
  });

  it("includes global tables", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("table:public.lookup_states");
    expect(block).toContain("table:public.service_types");
    expect(block).toContain("no tenant filter needed");
  });

  it("includes named placeholder for ids scope", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain(":tenant_agency_ids");
  });

  it("includes named placeholder for subtree scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "subtree",
        tenantRoot: "table:public.agencies",
        rootIds: ["42"],
        includeDescendants: true,
      },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain(":tenant_agency_ids");
    expect(block).toContain("subtree");
  });

  it("includes multiple placeholders for multi_root scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.clients", ids: ["99"] },
        ],
      },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain(":tenant_agency_ids");
    expect(block).toContain(":tenant_client_ids");
  });

  it("indicates global scope bypasses filtering", () => {
    const scope: TenantScope = {
      access: { kind: "global", reason: "super_admin" },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("GLOBAL");
    expect(block).toContain("super_admin");
    expect(block).toContain("tenant predicates are optional");
  });

  it("includes advisory context when present", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      context: {
        role: "regional_manager",
        region: "northeast",
        department: "sales",
        description: "Manages 3 sub-agencies",
      },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("regional_manager");
    expect(block).toContain("northeast");
    expect(block).toContain("sales");
    expect(block).toContain("Manages 3 sub-agencies");
    expect(block).toContain("advisory");
  });

  it("includes enforcement rules", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain("MUST include the tenant predicate");
    expect(block).toContain("named placeholders");
  });

  it("is deterministic", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block1 = buildTenantPromptBlock(policy, scope);
    const block2 = buildTenantPromptBlock(policy, scope);
    expect(block1).toBe(block2);
  });
});
