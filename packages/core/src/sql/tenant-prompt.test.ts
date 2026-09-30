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

  // ask() expands a subtree into per-root IDs before building the prompt (#338). An
  // unexpanded subtree has no IDs for its descendant levels, so a prompt naming only the
  // root's placeholder would invite the model to filter every level through it.
  it("rejects an unexpanded subtree scope", () => {
    const scope: TenantScope = {
      access: {
        kind: "subtree",
        tenantRoot: "table:public.agencies",
        rootIds: ["42"],
        includeDescendants: true,
      },
    };
    expect(() => buildTenantPromptBlock(policy, scope)).toThrow(
      expect.objectContaining({ name: "TenantScopeError", reason: "SUBTREE_NOT_RESOLVABLE" }),
    );
  });

  // Regression (#338): an expanded subtree is a multi_root scope, and each root table has
  // its own ID space. The prompt pairs every placeholder with the columns that hold that
  // root's IDs (its own ID, child-root foreign keys, scoped columns, polymorphic IDs), so
  // the model isn't left to guess which placeholder filters `sub_agencies.agency_id` or
  // `notes.owner_id`.
  it("pairs each multi_root placeholder with the columns that hold that root's IDs", () => {
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
    expect(block).toContain(
      [
        "Current user scope:",
        "  Access: multiple roots. Each placeholder holds the IDs of one tenant root; compare it only with the columns listed under it:",
        "    - Agency IDs = :tenant_agency_ids",
        "      columns: table:public.agencies#id, table:public.sub_agencies#agency_id, table:public.orders#agency_id, " +
          "table:public.campaigns#owning_agency, table:public.notes#owner_id (where table:public.notes#owner_type = 'agency')",
        "    - Client IDs = :tenant_client_ids",
        "      columns: table:public.clients#id, table:public.notes#owner_id (where table:public.notes#owner_type = 'client')",
        "  The same ID value can name different tenants in different root tables: never compare one root's placeholder with another root's column.",
        "  A root table listed here that the query reads must itself be filtered with its own placeholder, even when a joined ancestor is filtered too.",
        "",
      ].join("\n"),
    );
  });

  // #375 review: a subtree with IDs at its root only expands to `ids`. With several roots
  // in the policy the model still sees other roots' columns (#338's `c.id IN
  // (:tenant_agency_ids)`), so the pairing lines belong to the policy, not the scope kind.
  it("pairs an ids placeholder with its columns when the policy has several roots", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope);
    expect(block).toContain(
      [
        "Current user scope:",
        "  Access: Agency IDs = :tenant_agency_ids",
        "    columns: table:public.agencies#id, table:public.sub_agencies#agency_id, table:public.orders#agency_id, " +
          "table:public.campaigns#owning_agency, table:public.notes#owner_id (where table:public.notes#owner_type = 'agency')",
        "  Use :tenant_agency_ids as the parameter placeholder for tenant predicates.",
        "  The same ID value can name different tenants in different root tables: never compare one root's placeholder with another root's column.",
        "",
      ].join("\n"),
    );
  });

  // The prompt must name the same placeholder substitution binds: for a label with no
  // ASCII letters or digits, the one derived from the root's table name (#375 review).
  it("names the table-name placeholder for a root labelled in Cyrillic", () => {
    const cyrillic = {
      ...policy,
      roots: policy.roots.map((r) => (r.id === "table:public.clients" ? { ...r, label: "Клиент" } : r)),
    };
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["42"] },
          { tenantRoot: "table:public.clients", ids: ["99"] },
        ],
      },
    };
    const block = buildTenantPromptBlock(cyrillic, scope);
    expect(block).toContain("    - Клиент IDs = :tenant_clients_ids\n");
  });

  it("keeps the ids scope block unchanged for a single-root policy", () => {
    const agencyOnly = {
      ...policy,
      roots: policy.roots.filter((r) => r.id === "table:public.agencies"),
      hierarchy: [],
    };
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(agencyOnly, scope);
    expect(block).toContain(
      [
        "Current user scope:",
        "  Access: Agency IDs = :tenant_agency_ids",
        "  Use :tenant_agency_ids as the parameter placeholder for tenant predicates.",
        "",
      ].join("\n"),
    );
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
