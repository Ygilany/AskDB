---
"@askdb/core": minor
---

**Behavior change: `subtree` tenant scopes now include descendants.** Previously `ask()` with `tenantScope.access.kind: "subtree"` scoped the SQL to the named `rootIds` only and never expanded the hierarchy, so a state admin silently got none of the county rows beneath the state. `ask()` now expands the subtree to its full ID set before generation, so the same call returns rows for the whole subtree. That is what `subtree` always promised, but the returned data changes.

**`subtree` without a resolver now throws** instead of silently under-scoping. AskDB never opens a database connection, so the host supplies the expansion through a new `ask()` option (also accepted as an `@askdb/client` per-call override):

```ts
resolveTenantDescendants?: (
  tenantRoot: string,
  seedIds: readonly string[],
) => Promise<readonly string[]> | readonly string[];
```

It receives `access.tenantRoot` and `access.rootIds` and returns every ID of that root in the subtree. `ask()` unions the seeds into the result, so an ancestor keeps its own rows even when the resolver returns strict descendants only. A `subtree` scope with no resolver, or a resolver returning an empty array or anything other than an array of non-empty strings, throws `TenantScopeError` with the new reason `SUBTREE_NOT_RESOLVABLE`, before the model is called. The `ids`, `multi_root` and `global` access kinds are unchanged.

New exports: the `ResolveTenantDescendants` type and `expandClosure(seedIds, childrenOf)`, a breadth-first, cycle-safe closure over an in-memory hierarchy for use inside a resolver. Because `ask()` expands the scope before generation, the model now sees the expanded scope as an `ids` scope. `resolveTenantSql()` still substitutes an unexpanded `subtree`'s seed IDs only, so direct callers must pre-expand.
