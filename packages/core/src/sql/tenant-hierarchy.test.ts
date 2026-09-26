import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AskDbError } from "../errors.js";
import { loadSchema } from "../schema/v2/loader.js";
import type { NormalizedTenantPolicy, TenantRoot, HierarchyEdge } from "../schema/v2/tenant-policy.js";
import { expandClosure, parentLinkageFor } from "./tenant-hierarchy.js";

const here = dirname(fileURLToPath(import.meta.url));
const multiTenantDir = join(here, "../../../../fixtures/schemas/agency-multi-tenant.schema");

function childrenFrom(edges: Record<string, string[]>): (id: string) => readonly string[] {
  return (id) => edges[id] ?? [];
}

function policyWith(roots: TenantRoot[], hierarchy: HierarchyEdge[] = []): NormalizedTenantPolicy {
  return {
    schemaId: "test",
    enforcement: "strict",
    roots,
    hierarchy,
    scopedTables: [],
    polymorphicTables: [],
    globalTables: [],
    coverage: [],
    warnings: [],
    body: "",
    sections: {},
  };
}

const agencies: TenantRoot = { id: "agencies", tenantIdColumn: "agencies#id", label: "Agency" };
const counties: TenantRoot = { id: "counties", tenantIdColumn: "counties#id", label: "County" };

describe("expandClosure", () => {
  // Contract: a subtree scope reaches every level below the seed, not just the seed.
  // Shape mirrors a self-referencing org table (agency.parent_agency_id):
  // 1 -> {4, 5}, 5 -> {6}, 7 is a separate root.
  const agencyTree = childrenFrom({ "1": ["4", "5"], "5": ["6"] });

  it.each([
    { seeds: ["1"], expected: ["1", "4", "5", "6"] },
    { seeds: ["5"], expected: ["5", "6"] },
    { seeds: ["6"], expected: ["6"] },
    { seeds: ["7"], expected: ["7"] },
  ])("expands $seeds through every level of the tree", ({ seeds, expected }) => {
    expect(expandClosure(seeds, agencyTree).sort()).toEqual(expected);
  });

  it("returns a child shared by two parents once (diamond)", () => {
    const diamond = childrenFrom({ a: ["b", "c"], b: ["d"], c: ["d"] });
    expect(expandClosure(["a"], diamond).sort()).toEqual(["a", "b", "c", "d"]);
  });

  // Regression: the loader only warns on hierarchy cycles, so a cyclic policy can
  // still reach expansion; an unguarded walk would hang the process.
  it("terminates on a cycle and returns each node once", () => {
    const cycle = childrenFrom({ a: ["b"], b: ["c"], c: ["a"] });
    expect(expandClosure(["a"], cycle).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns exactly the (deduplicated) seeds when nothing has children", () => {
    expect(expandClosure(["x", "y", "x"], () => [])).toEqual(["x", "y"]);
  });
});

describe("parentLinkageFor", () => {
  it("reads a TenantRoot.parent declaration", () => {
    const policy = policyWith([
      agencies,
      { ...counties, parent: { root: "agencies", foreignKey: "counties#agency_id" } },
    ]);
    expect(parentLinkageFor(policy, "counties")).toEqual({
      parentRoot: "agencies",
      foreignKey: "counties#agency_id",
    });
  });

  it("reads an explicit hierarchy edge", () => {
    const policy = policyWith(
      [agencies, counties],
      [{ parent: "agencies", child: "counties", foreignKey: "counties#agency_id" }],
    );
    expect(parentLinkageFor(policy, "counties")).toEqual({
      parentRoot: "agencies",
      foreignKey: "counties#agency_id",
    });
  });

  it("returns undefined for a flat (top-level) root", () => {
    const policy = policyWith([agencies, counties]);
    expect(parentLinkageFor(policy, "agencies")).toBeUndefined();
  });

  // The shipped fixture declares every parent both ways; identical declarations
  // must collapse to one linkage rather than being treated as a conflict.
  it("accepts a root whose parent and hierarchy edge agree", () => {
    const policy = loadSchema(multiTenantDir).tenantPolicy!;
    expect(parentLinkageFor(policy, "table:public.clients")).toEqual({
      parentRoot: "table:public.sub_agencies",
      foreignKey: "table:public.clients#sub_agency_id",
    });
  });

  // Pinned precedence: neither source wins. The linkage decides which rows a
  // subtree can reach, so picking one of two disagreeing edges would silently
  // leak or drop rows; the policy author has to resolve the ambiguity.
  it("throws when the parent declaration and a hierarchy edge disagree", () => {
    const policy = policyWith(
      [agencies, { ...counties, parent: { root: "agencies", foreignKey: "counties#agency_id" } }],
      [{ parent: "agencies", child: "counties", foreignKey: "counties#owner_agency_id" }],
    );
    expect(() => parentLinkageFor(policy, "counties")).toThrow(AskDbError);
    expect(() => parentLinkageFor(policy, "counties")).toThrow(/conflicting parent linkage/);
  });
});
