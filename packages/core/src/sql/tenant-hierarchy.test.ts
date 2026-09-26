import { describe, expect, it } from "vitest";
import { expandClosure } from "./tenant-hierarchy.js";

function childrenFrom(edges: Record<string, string[]>): (id: string) => readonly string[] {
  return (id) => edges[id] ?? [];
}

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
