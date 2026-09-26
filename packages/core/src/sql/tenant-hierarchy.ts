import { AskDbError } from "../errors.js";
import type { NormalizedTenantPolicy } from "../schema/v2/tenant-policy.js";

/** How rows of a tenant root hang off their parent root. */
export type TenantParentLinkage = {
  /** Id of the parent tenant root. */
  parentRoot: string;
  /** Foreign-key column on the child root that references the parent root. */
  foreignKey: string;
};

/**
 * Resolve how rows of `rootId` are reached from their parent root, combining
 * `TenantRoot.parent` declarations and explicit `hierarchy` edges.
 *
 * Returns `undefined` when the root has no parent linkage — a flat tenancy,
 * where a subtree is just the named IDs.
 *
 * Precedence: neither source wins. Identical declarations (the common case —
 * the loader accepts a policy that states the same edge both ways) collapse to
 * one linkage. Declarations that disagree on the parent root or foreign key
 * throw instead of picking one, because this linkage decides which rows a
 * subtree scope can reach: silently choosing the wrong edge either leaks rows
 * across tenants or drops rows the caller is entitled to.
 */
export function parentLinkageFor(
  policy: NormalizedTenantPolicy,
  rootId: string,
): TenantParentLinkage | undefined {
  const candidates: Array<TenantParentLinkage & { source: string }> = [];

  const root = policy.roots.find((r) => r.id === rootId);
  if (root?.parent) {
    candidates.push({
      parentRoot: root.parent.root,
      foreignKey: root.parent.foreignKey,
      source: `roots[${rootId}].parent`,
    });
  }
  for (const edge of policy.hierarchy) {
    if (edge.child !== rootId) continue;
    candidates.push({
      parentRoot: edge.parent,
      foreignKey: edge.foreignKey,
      source: `hierarchy edge ${edge.parent} -> ${edge.child}`,
    });
  }

  const first = candidates[0];
  if (!first) return undefined;

  const conflict = candidates.find(
    (c) => c.parentRoot !== first.parentRoot || c.foreignKey !== first.foreignKey,
  );
  if (conflict) {
    throw new AskDbError(
      `Tenant root '${rootId}' has conflicting parent linkage: ` +
        `${first.source} says ${first.parentRoot} via ${first.foreignKey}, ` +
        `${conflict.source} says ${conflict.parentRoot} via ${conflict.foreignKey}. ` +
        `Make tenant-policy.md declare one parent linkage for this root.`,
    );
  }

  return { parentRoot: first.parentRoot, foreignKey: first.foreignKey };
}

/**
 * Expand `seedIds` to include every descendant reachable through `childrenOf`.
 * Breadth-first with a visited set, so a cyclic hierarchy terminates instead
 * of hanging. Returned IDs are unique and include the seeds.
 *
 * Useful inside a `resolveTenantDescendants` callback when the host holds its
 * hierarchy in memory (e.g. a cached parent map of a self-referencing org table).
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
