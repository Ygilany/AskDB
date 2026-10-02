import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";

/**
 * Expand `seedIds` to include every descendant reachable through `childrenOf`.
 * Breadth-first with a visited set, so a cyclic hierarchy terminates instead
 * of hanging. Returned IDs are unique and include the seeds.
 *
 * Useful inside a `resolveTenantDescendants` callback when the host holds one
 * root's hierarchy in memory (e.g. a cached parent map of a self-referencing org
 * table). The IDs it returns all belong to that one root.
 */
export function expandClosure(
  seedIds: readonly string[],
  childrenOf: (id: string) => readonly string[],
): string[] {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const id of seedIds) {
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const child of childrenOf(queue[i]!)) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
    }
  }
  return queue;
}

/**
 * The tenant roots a `subtree` of `tenantRoot` spans: `tenantRoot` first, then every
 * root reachable from it through `roots[].parent` or `hierarchy[]` edges, breadth-first.
 * Edges to roots the policy doesn't declare are skipped, since they have no placeholder.
 * These are the keys a `resolveTenantDescendants` result may use.
 */
export function subtreeRootIds(
  policy: Pick<NormalizedTenantPolicy, "roots" | "hierarchy">,
  tenantRoot: string,
): string[] {
  const declared = new Set(policy.roots.map((root) => root.id));
  const children = new Map<string, string[]>();
  const link = (parent: string, child: string) => {
    if (!declared.has(child)) return;
    const list = children.get(parent) ?? [];
    if (!list.includes(child)) list.push(child);
    children.set(parent, list);
  };
  for (const root of policy.roots) if (root.parent) link(root.parent.root, root.id);
  for (const edge of policy.hierarchy) link(edge.parent, edge.child);
  return expandClosure([tenantRoot], (id) => children.get(id) ?? []);
}
