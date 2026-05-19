import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { loadSchema } from "./loader.js";
import {
  parseTenantPolicyMarkdown,
  normalizeTenantPolicy,
} from "./tenant-policy-loader.js";
import { tenantPolicyFrontmatterSchema, tenantScopeSchema } from "./tenant-policy.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../../../../fixtures/schemas");
const multiTenantDir = join(fixturesDir, "agency-multi-tenant.schema");
const nonTenantDir = join(fixturesDir, "orders-users.schema");

// ---------------------------------------------------------------------------
// Fixture loading via loadSchema
// ---------------------------------------------------------------------------

describe("loadSchema — multi-tenant fixture", () => {
  it("loads the fixture with tenant policy", () => {
    const schema = loadSchema(multiTenantDir);
    expect(schema.schemaId).toBe("agency-multi-tenant");
    expect(schema.tenantPolicy).toBeDefined();
    expect(schema.tenantPolicy!.enforcement).toBe("strict");
  });

  it("includes all 9 tables from the physical layer", () => {
    const schema = loadSchema(multiTenantDir);
    expect(schema.tables).toHaveLength(9);
  });

  it("has no warnings for a well-formed fixture", () => {
    const schema = loadSchema(multiTenantDir);
    expect(schema.tenantPolicy!.warnings).toEqual([]);
  });

  it("does not load tenant policy for non-tenant schemas", () => {
    const schema = loadSchema(nonTenantDir);
    expect(schema.tenantPolicy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

describe("tenant policy coverage report", () => {
  it("classifies every table in the physical schema", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const tableIds = schema.tables.map((t) => t.id);
    const coveredIds = coverage.map((c) => c.tableId);
    for (const id of tableIds) {
      expect(coveredIds).toContain(id);
    }
  });

  it("classifies root tables as 'root'", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const roots = coverage.filter((c) => c.classification === "root");
    expect(roots.map((r) => r.tableId).sort()).toEqual([
      "table:public.agencies",
      "table:public.clients",
      "table:public.sub_agencies",
    ]);
  });

  it("classifies directly scoped tables as 'scoped'", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const scoped = coverage.filter((c) => c.classification === "scoped");
    expect(scoped.map((s) => s.tableId).sort()).toEqual([
      "table:public.campaigns",
      "table:public.orders",
    ]);
  });

  it("classifies inherited tables as 'inherited'", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const inherited = coverage.filter((c) => c.classification === "inherited");
    expect(inherited.map((i) => i.tableId)).toEqual(["table:public.appointments"]);
  });

  it("classifies polymorphic tables as 'polymorphic'", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const poly = coverage.filter((c) => c.classification === "polymorphic");
    expect(poly.map((p) => p.tableId)).toEqual(["table:public.notes"]);
  });

  it("classifies global tables as 'global'", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const global = coverage.filter((c) => c.classification === "global");
    expect(global.map((g) => g.tableId).sort()).toEqual([
      "table:public.lookup_states",
      "table:public.service_types",
    ]);
  });

  it("has no 'unknown' tables when all are classified", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const unknown = coverage.filter((c) => c.classification === "unknown");
    expect(unknown).toEqual([]);
  });

  it("reports scope roots for scoped tables", () => {
    const schema = loadSchema(multiTenantDir);
    const coverage = schema.tenantPolicy!.coverage;
    const orders = coverage.find((c) => c.tableId === "table:public.orders")!;
    expect(orders.scopeRoots).toEqual(["table:public.agencies"]);
  });

  it("coverage is sorted deterministically by tableId", () => {
    const schema = loadSchema(multiTenantDir);
    const ids = schema.tenantPolicy!.coverage.map((c) => c.tableId);
    expect(ids).toEqual([...ids].sort());
  });
});

// ---------------------------------------------------------------------------
// Tenant policy parsing
// ---------------------------------------------------------------------------

describe("parseTenantPolicyMarkdown", () => {
  it("parses valid front-matter", () => {
    const content = `---
schemaId: test
enforcement: strict
roots:
  - id: table:public.tenants
    tenantIdColumn: table:public.tenants#id
    label: Tenant
---

# Tenant Policy

Some description.
`;
    const parsed = parseTenantPolicyMarkdown(content);
    expect(parsed.frontmatter.schemaId).toBe("test");
    expect(parsed.frontmatter.enforcement).toBe("strict");
    expect(parsed.frontmatter.roots).toHaveLength(1);
  });

  it("extracts recognized H2 sections", () => {
    const content = `---
schemaId: test
enforcement: warn
roots:
  - id: table:public.t
    tenantIdColumn: table:public.t#id
    label: T
---

# Tenant Policy

## Hierarchy

Agency tree.

## Scope rules

Direct filtering.

## Sensitive interactions

PII is separate.
`;
    const parsed = parseTenantPolicyMarkdown(content);
    expect(parsed.sections["Hierarchy"]).toContain("Agency tree.");
    expect(parsed.sections["Scope rules"]).toContain("Direct filtering.");
    expect(parsed.sections["Sensitive interactions"]).toContain("PII is separate.");
  });

  it("throws SchemaParseError for invalid front-matter", () => {
    const content = `---
schemaId: test
---
`;
    expect(() => parseTenantPolicyMarkdown(content)).toThrow(SchemaParseError);
  });

  it("rejects unknown front-matter keys", () => {
    const content = `---
schemaId: test
enforcement: strict
roots:
  - id: table:public.t
    tenantIdColumn: table:public.t#id
    label: T
unknownKey: bad
---
`;
    expect(() => parseTenantPolicyMarkdown(content)).toThrow(SchemaParseError);
  });
});

// ---------------------------------------------------------------------------
// Cross-reference validation
// ---------------------------------------------------------------------------

describe("normalizeTenantPolicy — cross-reference validation", () => {
  const validContent = `---
schemaId: test
enforcement: strict
roots:
  - id: table:public.orgs
    tenantIdColumn: table:public.orgs#id
    label: Org
scopedTables:
  - id: table:public.items
    scopeThrough:
      - root: table:public.orgs
        column: table:public.items#org_id
globalTables:
  - table:public.lookups
---
`;

  it("produces no warnings when all IDs are valid", () => {
    const parsed = parseTenantPolicyMarkdown(validContent);
    const tableIds = new Set([
      "table:public.orgs",
      "table:public.items",
      "table:public.lookups",
    ]);
    const colIds = new Set([
      "table:public.orgs#id",
      "table:public.items#org_id",
    ]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings).toEqual([]);
  });

  it("warns about orphaned root table IDs", () => {
    const parsed = parseTenantPolicyMarkdown(validContent);
    const tableIds = new Set(["table:public.items", "table:public.lookups"]);
    const colIds = new Set(["table:public.orgs#id", "table:public.items#org_id"]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "orphaned_root_id")).toBe(true);
  });

  it("warns about orphaned column IDs in roots", () => {
    const parsed = parseTenantPolicyMarkdown(validContent);
    const tableIds = new Set([
      "table:public.orgs",
      "table:public.items",
      "table:public.lookups",
    ]);
    const colIds = new Set(["table:public.items#org_id"]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "orphaned_column_id")).toBe(true);
  });

  it("warns about orphaned scoped table IDs", () => {
    const parsed = parseTenantPolicyMarkdown(validContent);
    const tableIds = new Set(["table:public.orgs", "table:public.lookups"]);
    const colIds = new Set(["table:public.orgs#id", "table:public.items#org_id"]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "orphaned_scoped_table_id")).toBe(true);
  });

  it("warns about orphaned global table IDs", () => {
    const parsed = parseTenantPolicyMarkdown(validContent);
    const tableIds = new Set(["table:public.orgs", "table:public.items"]);
    const colIds = new Set(["table:public.orgs#id", "table:public.items#org_id"]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "orphaned_global_table_id")).toBe(true);
  });

  it("warns about unknown roots in scopeThrough", () => {
    const content = `---
schemaId: test
enforcement: strict
roots:
  - id: table:public.orgs
    tenantIdColumn: table:public.orgs#id
    label: Org
scopedTables:
  - id: table:public.items
    scopeThrough:
      - root: table:public.nonexistent
        column: table:public.items#org_id
---
`;
    const parsed = parseTenantPolicyMarkdown(content);
    const tableIds = new Set(["table:public.orgs", "table:public.items"]);
    const colIds = new Set(["table:public.orgs#id", "table:public.items#org_id"]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "unknown_root_in_scope")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hierarchy cycle detection
// ---------------------------------------------------------------------------

describe("normalizeTenantPolicy — hierarchy cycle detection", () => {
  it("detects cycles in roots with parent references", () => {
    const content = `---
schemaId: test
enforcement: strict
roots:
  - id: table:public.a
    tenantIdColumn: table:public.a#id
    label: A
    parent:
      root: table:public.b
      foreignKey: table:public.a#b_id
  - id: table:public.b
    tenantIdColumn: table:public.b#id
    label: B
    parent:
      root: table:public.a
      foreignKey: table:public.b#a_id
---
`;
    const parsed = parseTenantPolicyMarkdown(content);
    const tableIds = new Set(["table:public.a", "table:public.b"]);
    const colIds = new Set([
      "table:public.a#id",
      "table:public.a#b_id",
      "table:public.b#id",
      "table:public.b#a_id",
    ]);
    const result = normalizeTenantPolicy(parsed, tableIds, colIds);
    expect(result.warnings.some((w) => w.kind === "hierarchy_cycle")).toBe(true);
  });

  it("does not flag acyclic hierarchies", () => {
    const schema = loadSchema(multiTenantDir);
    expect(schema.tenantPolicy!.warnings.some((w) => w.kind === "hierarchy_cycle")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Zod schema validation for front-matter
// ---------------------------------------------------------------------------

describe("tenantPolicyFrontmatterSchema", () => {
  it("accepts valid minimal policy", () => {
    const result = tenantPolicyFrontmatterSchema.safeParse({
      schemaId: "test",
      enforcement: "strict",
      roots: [{ id: "table:public.t", tenantIdColumn: "table:public.t#id", label: "T" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing enforcement", () => {
    const result = tenantPolicyFrontmatterSchema.safeParse({
      schemaId: "test",
      roots: [{ id: "table:public.t", tenantIdColumn: "table:public.t#id", label: "T" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid enforcement value", () => {
    const result = tenantPolicyFrontmatterSchema.safeParse({
      schemaId: "test",
      enforcement: "invalid",
      roots: [{ id: "table:public.t", tenantIdColumn: "table:public.t#id", label: "T" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty roots", () => {
    const result = tenantPolicyFrontmatterSchema.safeParse({
      schemaId: "test",
      enforcement: "warn",
      roots: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runtime TenantScope validation
// ---------------------------------------------------------------------------

describe("tenantScopeSchema", () => {
  it("accepts ids access kind", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["1", "2"] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts subtree access kind", () => {
    const result = tenantScopeSchema.safeParse({
      access: {
        kind: "subtree",
        tenantRoot: "table:public.agencies",
        rootIds: ["1"],
        includeDescendants: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts multi_root access kind", () => {
    const result = tenantScopeSchema.safeParse({
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["1"] },
          { tenantRoot: "table:public.clients", ids: ["99"] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts global access kind", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "global", reason: "super_admin" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects global without reason", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "global", reason: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ids with empty ids array", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts scope with advisory context", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      context: {
        role: "regional_manager",
        region: "northeast",
        department: "sales",
        label: "Jane Smith",
        description: "Manages 3 sub-agencies in the NE region",
        attributes: { custom_key: "custom_value" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts scope with tenantFilters", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      tenantFilters: {
        "table:public.notes": {
          conditions: [
            { column: "table:public.notes#owner_type", operator: "=", value: "agency" },
            { column: "table:public.notes#owner_id", operator: "IN", value: ["42"] },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown context keys", () => {
    const result = tenantScopeSchema.safeParse({
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
      context: { role: "admin", unknownKey: "bad" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Normalization structure
// ---------------------------------------------------------------------------

describe("normalized tenant policy structure", () => {
  it("includes hierarchy edges", () => {
    const schema = loadSchema(multiTenantDir);
    const policy = schema.tenantPolicy!;
    expect(policy.hierarchy).toHaveLength(2);
    expect(policy.hierarchy[0].parent).toBe("table:public.agencies");
    expect(policy.hierarchy[0].child).toBe("table:public.sub_agencies");
  });

  it("includes polymorphic table mappings", () => {
    const schema = loadSchema(multiTenantDir);
    const policy = schema.tenantPolicy!;
    expect(policy.polymorphicTables).toHaveLength(1);
    expect(policy.polymorphicTables[0].id).toBe("table:public.notes");
    expect(policy.polymorphicTables[0].mapping).toEqual({
      agency: "table:public.agencies",
      sub_agency: "table:public.sub_agencies",
      client: "table:public.clients",
    });
  });

  it("preserves body prose", () => {
    const schema = loadSchema(multiTenantDir);
    const policy = schema.tenantPolicy!;
    expect(policy.body).toContain("multi-level agency management platform");
  });

  it("extracts recognized sections from body", () => {
    const schema = loadSchema(multiTenantDir);
    const policy = schema.tenantPolicy!;
    expect(policy.sections["Hierarchy"]).toContain("top-level tenants");
    expect(policy.sections["Scope rules"]).toContain("polymorphic ownership");
    expect(policy.sections["Sensitive interactions"]).toContain("PII columns");
  });
});
