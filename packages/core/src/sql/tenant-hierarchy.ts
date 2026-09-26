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
