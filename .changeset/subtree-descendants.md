---
"@askdb/core": minor
---

**Behavior change: `subtree` tenant scopes now include descendants.** Previously `ask()` with `tenantScope.access.kind: "subtree"` scoped the SQL to the named `rootIds` only and never expanded the hierarchy, so an agency admin silently got none of the rows beneath their agency. `ask()` now expands the subtree before generation, so the same call returns rows for the whole subtree. That is what `subtree` always promised, but the returned data changes.

**`subtree` without a resolver now throws** instead of silently under-scoping. AskDB never opens a database connection, so the host supplies the expansion through a new `ask()` option (also accepted as an `@askdb/client` per-call override):

```ts
type TenantIdsByRoot = Readonly<Record<string, readonly string[]>>;

resolveTenantDescendants?: (
  tenantRoot: string,
  seedIds: readonly string[],
) => Promise<TenantIdsByRoot> | TenantIdsByRoot;
```

It receives `access.tenantRoot` and `access.rootIds` and returns the subtree's IDs grouped by tenant root, keyed by root table ID: the seeds and any same-table descendants under `tenantRoot`, and each descendant root's IDs (through the policy's `roots[].parent` or `hierarchy`) under that root. For example, `{ "table:public.agencies": ["1"], "table:public.sub_agencies": ["5"], "table:public.clients": ["5"] }`. Root tables have separate ID spaces, so `ask()` binds each root's IDs only to that root's own `:tenant_<label>_ids` placeholder: the expanded scope is a `multi_root` scope, or an `ids` scope when only `tenantRoot` has IDs. `ask()` unions the seeds into the `tenantRoot` entry, so an ancestor keeps its own rows even when the resolver returns strict descendants only.

A `subtree` scope with no resolver, or a resolver that returns an array, a key that isn't a tenant root in the subtree, a value that isn't an array of non-empty strings, or no IDs at all, throws `TenantScopeError` with the new reason `SUBTREE_NOT_RESOLVABLE`, before the model is called. The `ids`, `multi_root` and `global` access kinds are unchanged.

New exports: the `ResolveTenantDescendants` and `TenantIdsByRoot` types, and `expandClosure(seedIds, childrenOf)`, a breadth-first, cycle-safe closure over one root's in-memory hierarchy for use inside a resolver. `resolveTenantSql()` and `buildTenantPromptBlock()` do not expand a `subtree`, so direct callers must pre-expand it into a `multi_root` access.
