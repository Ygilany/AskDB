import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema, loadSchemaFromJson } from "../schema/v2/loader.js";
import type { NormalizedSchemaV2 } from "../schema/v2/normalized.js";
import type { NormalizedTenantPolicy, TenantScope } from "../schema/v2/tenant-policy.js";
import { buildTenantPromptBlock } from "./tenant-prompt.js";
import { buildNlToSqlUserPrompt } from "./prompt.js";
import { POSTGRES_DIALECT } from "./dialect-spec.js";
import { AskDbError } from "../errors.js";

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
    const block = buildTenantPromptBlock(policy, scope, { schema });
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain("Tenant-scoped tables (MUST include tenant predicate):");
    expect(block).toContain("  - table:public.orders → filter via table:public.orders#agency_id (Agency scope)");
  });

  it("includes inherited scope join paths", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain("table:public.appointments");
    expect(block).toContain("join path");
  });

  it("includes polymorphic table instructions", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain(
      "  - table:public.notes: type column = table:public.notes#owner_type, id column = table:public.notes#owner_id",
    );
    expect(block).toContain("    - 'agency' → Agency");
  });

  it("includes global tables", () => {
    const scope: TenantScope = {
      access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] },
    };
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain("table:public.lookup_states");
    expect(block).toContain("table:public.service_types");
    expect(block).toContain("no tenant filter needed");
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
    expect(() => buildTenantPromptBlock(policy, scope, { schema })).toThrow(
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
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
        "  A root table listed here that the query reads must itself be filtered with its own placeholder; " +
          "filtering it only through its parent's foreign key or a joined ancestor is not enough.",
        "",
      ].join("\n"),
    );
  });

  // Under an expanded subtree every level is in the scope, and the guardrail checks each
  // as a root table: filtering `clients` by `sub_agency_id` is rejected. So the column
  // list mustn't offer a child root's foreign key when that child is itself in the scope,
  // and the closing line says why (#375 review). Empty levels are listed as having no IDs.
  it("omits a covered child root's foreign key from its parent's columns", () => {
    const scope: TenantScope = {
      access: {
        kind: "multi_root",
        scopes: [
          { tenantRoot: "table:public.agencies", ids: ["1"] },
          { tenantRoot: "table:public.sub_agencies", ids: ["5"] },
          { tenantRoot: "table:public.clients", ids: [] },
        ],
      },
    };
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain(
      [
        "    - Agency IDs = :tenant_agency_ids",
        "      columns: table:public.agencies#id, table:public.orders#agency_id, " +
          "table:public.campaigns#owning_agency, table:public.notes#owner_id (where table:public.notes#owner_type = 'agency')",
        "    - Sub-Agency IDs = :tenant_sub_agency_ids",
        "      columns: table:public.sub_agencies#id, table:public.notes#owner_id (where table:public.notes#owner_type = 'sub_agency')",
        "    - Client IDs = :tenant_client_ids (no IDs in this scope: don't read this table)",
        "      columns: table:public.clients#id, table:public.notes#owner_id (where table:public.notes#owner_type = 'client')",
        "  The same ID value can name different tenants in different root tables: never compare one root's placeholder with another root's column.",
        "  A root table listed here that the query reads must itself be filtered with its own placeholder; " +
          "filtering it only through its parent's foreign key or a joined ancestor is not enough.",
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
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
    const block = buildTenantPromptBlock(cyrillic, scope, { schema });
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
    const block = buildTenantPromptBlock(agencyOnly, scope, { schema });
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
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
    const block = buildTenantPromptBlock(policy, scope, { schema });
    expect(block).toContain("MUST include the tenant predicate");
    expect(block).toContain("named placeholders");
  });
});

describe("buildTenantPromptBlock — only the tables the prompt shows (#771, ADR 0038)", () => {
  const idsScope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
  const multiRoot: TenantScope = {
    access: {
      kind: "multi_root",
      scopes: [
        { tenantRoot: "table:public.agencies", ids: ["42"] },
        { tenantRoot: "table:public.clients", ids: ["99"] },
      ],
    },
  };
  const allIds = schema.tables.map((t) => t.id);
  // `tracked` comes from a table's markdown front-matter, so it's set on a copy of the loaded schema.
  const untracking = (...ids: string[]): NormalizedSchemaV2 => {
    const copy = structuredClone(schema);
    for (const t of copy.tables) if (ids.includes(t.id)) t.tracked = false;
    return copy;
  };
  const block = (scope: TenantScope, s: NormalizedSchemaV2 = schema, tableIds?: string[]) =>
    buildTenantPromptBlock(policy, scope, { schema: s, ...(tableIds ? { tableIds } : {}) });

  it("keeps a root's label and placeholder when its table isn't shown, and drops its table id and columns", () => {
    const b = block(idsScope, untracking("table:public.agencies"));
    expect(b).toContain("  - Agency (top-level)");
    expect(b).toContain("Access: Agency IDs = :tenant_agency_ids");
    // A shown table's column that holds the root's IDs stays, so its predicate can be written.
    expect(b).toContain("table:public.orders#agency_id");
    expect(b).not.toContain("table:public.agencies");
  });

  it("drops a join path through an untracked table, so the scoped table can't be filtered that way", () => {
    const b = block(idsScope, untracking("table:public.clients"));
    expect(b).toContain("  - table:public.appointments → no filter path this prompt can show: don't read this table");
    expect(b).not.toContain("join path");
  });

  it("keeps a join path through a tracked table retrieval left out, and the root column it reaches", () => {
    const b = block(multiRoot, schema, allIds.filter((id) => id !== "table:public.clients"));
    expect(b).toContain(
      "  - table:public.appointments → join path: table:public.appointments#client_id → table:public.clients#id (Client scope)",
    );
    // The path's predicate compares :tenant_client_ids with clients.id, so that column stays under it.
    const clientColumns = b.split("\n").find((l, i, all) => all[i - 1]?.includes(":tenant_client_ids") && l.includes("columns:"));
    expect(clientColumns).toContain("table:public.clients#id");
    expect(b).not.toContain("Client [table:public.clients]");
  });

  it("leaves an untracked table's columns out of a multi_root scope's lists", () => {
    const b = block(multiRoot, untracking("table:public.campaigns"));
    expect(b).not.toContain("campaigns");
    expect(b).toContain("table:public.orders#agency_id");
  });

  it("names every policy table when every one is tracked and no retrieval narrows the prompt", () => {
    const b = buildTenantPromptBlock(policy, idsScope, { schema });
    for (const id of ["table:public.agencies", "table:public.campaigns", "table:public.notes", "table:public.lookup_states"]) {
      expect(b, id).toContain(id);
    }
  });

  it("names an undeclared root only when the prompt shows its table", () => {
    // A warn policy can point a mapping or a scope path at a table that isn't a declared root.
    const loose: NormalizedTenantPolicy = structuredClone(policy);
    loose.roots = loose.roots.filter((r) => r.id !== "table:public.clients");
    loose.hierarchy = loose.hierarchy.filter((h) => h.child !== "table:public.clients");
    const b = buildTenantPromptBlock(loose, idsScope, { schema: untracking("table:public.clients") });
    expect(b).toContain("'client' → an undeclared root");
    expect(b).not.toContain("table:public.clients");
  });

  it("leaves out a column path or polymorphic column that sits on an untracked table", () => {
    // The loader only checks that a policy column exists somewhere, so a slip can point a scoped or
    // polymorphic table at another table's column.
    const slipped: NormalizedTenantPolicy = structuredClone(policy);
    slipped.scopedTables = slipped.scopedTables.map((st) =>
      st.id === "table:public.orders"
        ? { ...st, scopeThrough: [{ root: "table:public.agencies", column: "table:public.campaigns#owning_agency" }] }
        : st,
    );
    slipped.polymorphicTables = slipped.polymorphicTables.map((pt) => ({ ...pt, idColumn: "table:public.campaigns#owning_agency" }));
    const b = buildTenantPromptBlock(slipped, idsScope, { schema: untracking("table:public.campaigns") });
    expect(b).not.toContain("campaigns");
    expect(b).toContain("  - table:public.orders → no filter path this prompt can show: don't read this table");
    expect(b).toContain("  - table:public.notes: no filter this prompt can show: don't read this table");
  });

  describe("a table name holding `#` (SQL Server)", () => {
    const column = (table: string, name: string) => ({ id: `${table}#${name}`, name, type: "int", nullable: false, primaryKey: name === "Id" });
    const table = (name: string, columns: string[]) => {
      const id = `table:dbo.${name}`;
      return { id, name, schema: "dbo", columns: columns.map((c) => column(id, c)) };
    };
    const hashSchema = (untracked: string[] = []): NormalizedSchemaV2 => {
      const s = loadSchemaFromJson(
        JSON.stringify({
          version: 2,
          schemaId: "hash",
          tables: [
            table("Agencies", ["Id"]),
            table("Orders", ["Id", "AgencyId"]),
            table("Orders#Archive", ["Id", "AgencyId"]),
            table("Client#Accounts", ["Id", "AgencyId"]),
            table("Visits", ["Id", "AccountId"]),
          ],
        }),
      );
      for (const t of s.tables) if (untracked.includes(t.id)) t.tracked = false;
      return s;
    };
    const hashPolicy: NormalizedTenantPolicy = {
      ...structuredClone(policy),
      schemaId: "hash",
      roots: [{ id: "table:dbo.Agencies", tenantIdColumn: "table:dbo.Agencies#Id", label: "Agency" }],
      hierarchy: [],
      scopedTables: [
        { id: "table:dbo.Orders", scopeThrough: [{ root: "table:dbo.Agencies", column: "table:dbo.Orders#AgencyId" }] },
        { id: "table:dbo.Orders#Archive", scopeThrough: [{ root: "table:dbo.Agencies", column: "table:dbo.Orders#Archive#AgencyId" }] },
        {
          id: "table:dbo.Visits",
          scopeThrough: [
            {
              root: "table:dbo.Agencies",
              join: [
                { from: "table:dbo.Visits#AccountId", to: "table:dbo.Client#Accounts#Id" },
                { from: "table:dbo.Client#Accounts#AgencyId", to: "table:dbo.Agencies#Id" },
              ],
            },
          ],
        },
      ],
      polymorphicTables: [],
      globalTables: [],
    };
    const multiRootAgency: TenantScope = { access: { kind: "multi_root", scopes: [{ tenantRoot: "table:dbo.Agencies", ids: ["1"] }] } };

    it("finds each column's table in the schema, not by splitting its id", () => {
      const b = buildTenantPromptBlock(hashPolicy, multiRootAgency, { schema: hashSchema() });
      expect(b).toContain("  - table:dbo.Visits → join path: table:dbo.Visits#AccountId → table:dbo.Client#Accounts#Id");
      expect(b).not.toContain("no filter path");
    });

    it("leaves out an untracked table whose name extends a tracked one's", () => {
      const b = buildTenantPromptBlock(hashPolicy, multiRootAgency, { schema: hashSchema(["table:dbo.Orders#Archive"]) });
      expect(b).not.toContain("Orders#Archive");
      expect(b).toContain("table:dbo.Orders#AgencyId");
    });
  });
});

describe("buildNlToSqlUserPrompt — the tenant block needs the tables the prompt shows (#771)", () => {
  const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };
  const prompt = (prebuiltDdl?: string, promptTableIds?: readonly string[], s: Parameters<typeof buildNlToSqlUserPrompt>[2] = schema) =>
    buildNlToSqlUserPrompt(POSTGRES_DIALECT, "how many orders", s, [], undefined, undefined, prebuiltDdl, policy, scope, undefined, promptTableIds);

  it("follows the schema's tracked tables without prebuilt DDL", () => {
    expect(prompt()).toContain("table:public.campaigns");
  });

  it("refuses prebuilt DDL without the ids of the tables it shows", () => {
    expect(() => prompt("TABLE public.orders")).toThrow(AskDbError);
    expect(() => prompt("TABLE public.orders")).toThrow(/pass promptTableIds/);
  });

  it("names only the retrieved tables with prebuilt DDL and their ids", () => {
    const p = prompt("TABLE public.orders", ["table:public.orders"]);
    expect(p).toContain("  - table:public.orders → filter via table:public.orders#agency_id (Agency scope)");
    expect(p).not.toContain("table:public.campaigns");
  });

  it("refuses a tenant policy with a v1 schema, which has no tracked tables to follow", () => {
    const v1 = { tables: [{ name: "orders", columns: [{ name: "id", type: "int", nullable: false, primaryKey: true }] }] };
    expect(() => prompt(undefined, undefined, v1)).toThrow(/needs the schema artifact/);
  });
});
