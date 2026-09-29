# ADR 0014 — A `subtree` tenant scope expands per root, not into one flat ID list

## Status

Accepted (2026-09-29, maintainer decision on #338, option 1). Implemented in `@askdb/core` (`packages/core/src/ask.ts`, `expandSubtreeScope`; `packages/core/src/sql/tenant-prompt.ts`).

## Context

A `subtree` access (`{ kind: "subtree", tenantRoot, rootIds, includeDescendants: true }`) means "these tenants and everything beneath them". AskDB never queries the database, so the host expands the subtree through the `resolveTenantDescendants` callback on `ask()`.

#270 (closing #232) shipped that callback returning one flat `string[]`, documented as "every ID in the subtree". `ask()` unioned the seeds in and bound the whole list to the scope root's placeholder, as an `ids` scope.

The tenant-policy contract's hierarchy is between **different root tables** (pattern P4: `roots[].parent` and `hierarchy[]`, e.g. `agencies` → `sub_agencies` → `clients`), and each root table has its own ID space. A resolver that walked that hierarchy returned sub-agency and client IDs, and `ask()` bound them to `:tenant_agency_ids`. With per-table sequences a descendant's ID often equals another tenant's agency ID, so `orders.agency_id IN ('1', '5')` returned the other tenant's orders (#338 reproduces it on SQLite). The tenant guardrail passed, because the predicate was well-formed; only the IDs' meaning was wrong. The flat list has no level key, so `ask()` couldn't tell an agency ID from a client ID.

The fix belongs in `@askdb/core`, which owns the resolver contract, the expansion, placeholder substitution and the prompt. Not in the guardrail (the SQL is well-formed) and not in the host (it authorized the IDs correctly, and AskDB gave it no way to say which root they belong to).

## Options considered

### A. Keep the flat list and fold it into the root's placeholder (#270 as shipped)

Rejected. It is the leak. It is only correct when every ID in the subtree belongs to the scope's root table, which holds for a same-table tree (`agencies.parent_agency_id`) but not for the multi-table hierarchy the policy actually declares. Rewording the docs to "IDs of the same root only" makes it safe but useless for P4: `subtree` would then mean the seeds alone.

### B. The resolver returns IDs per root; `ask()` expands the subtree into `multi_root` (chosen)

The resolver returns `Record<rootTableId, string[]>`. `ask()` keeps each root's IDs under that root, so each binds only to that root's own `:tenant_<label>_ids` placeholder. `multi_root` already flows through the prompt, the guardrail and substitution, so no new scope kind is needed. Folding becomes impossible by construction, because `ask()` never moves an ID from one key to another.

Cost: a breaking change to the `ResolveTenantDescendants` return type, acceptable because #270 is unreleased (`.changeset/subtree-descendants.md` was still pending) and AskDB is pre-1.0. It also puts more placeholders in front of the model, which must pair each one with the right column (see Consequences).

### C. Refuse `subtree` when the scope's root has child roots

`ask()` would throw `SUBTREE_NOT_RESOLVABLE` for any root with child roots, so a P4 hierarchy never reaches the folding path. Hosts would use `ids` on the top root and join up to it, or build `multi_root` themselves. Smallest change, and the same-table case keeps working.

Rejected by the maintainer: it leaves the access kind the policy's hierarchy exists for unusable on exactly the hierarchies the policy can declare, and pushes every host to hand-build the per-root expansion that option B does once, in core.

## Decision

- **Resolver shape.** `ResolveTenantDescendants = (tenantRoot, seedIds) => TenantIdsByRoot | Promise<TenantIdsByRoot>`, where `TenantIdsByRoot = Readonly<Record<string, readonly string[]>>` (both exported from `@askdb/core`). Keys are root table IDs from the policy. Under `tenantRoot` go the seeds and any same-table descendants; under each descendant root go that root's own IDs.
- **Allowed keys.** `tenantRoot` and every root reachable from it through `roots[].parent` or `hierarchy[]` edges, breadth-first (`subtreeRootIds` in `packages/core/src/sql/tenant-hierarchy.ts`). The resolver receives only `tenantRoot` and the seeds, not the list of levels; the error message for a bad key lists the allowed keys. Passing the levels to the resolver can be added later without breaking it.
- **Expansion.** `ask()` unions the seeds into the `tenantRoot` entry, drops roots with no IDs, and produces `{ kind: "multi_root", scopes }` in level order, or the equivalent `{ kind: "ids" }` when only `tenantRoot` has IDs. That keeps the prompt for a same-table tree byte-identical to an `ids` scope. The expansion runs before generation, so the prompt, the guardrail and substitution all see the per-root scope.
- **Fail closed** with `TenantScopeError` reason `SUBTREE_NOT_RESOLVABLE`, before the model is called: no resolver; an array result (the old flat shape, with a message that shows the per-root shape to migrate to); a non-object result (`null`, a `Map`); a key that isn't a tenant root in the policy, or a root outside this subtree; a value that isn't an array of non-empty strings; no IDs at all. The flat shape is rejected, not accepted with a warning: accepting it is the leak. A placeholder for a root with no IDs keeps throwing `UNRESOLVED_TENANT_PLACEHOLDER`.
- **Prompt pairing.** The `multi_root` block lists, under each placeholder, the columns that hold that root's IDs: its `tenantIdColumn`, child roots' foreign keys to it, scoped tables' direct columns, and polymorphic ID columns with the discriminator value that maps to it. It adds "never compare one root's placeholder with another root's column". Join-path tables are left to the existing join-path lines, which filter on the root's own column after the join. `buildTenantPromptBlock()` and `resolveTenantSql()` reject an unexpanded `subtree` rather than render or bind the root's placeholder alone.
- **Owner.** All of this is in `@askdb/core`. `@askdb/client` only forwards the resolver (`AskOverrides` is derived from `ask()`'s options). Studio builds no `subtree` scope (it has no resolver to pass), and the HTTP API takes no tenant scope.

## Consequences

- **Breaking for resolvers written against #270.** A resolver returning `string[]` now throws, with a message naming the per-root shape. #270 never shipped, so the only callers are in this repository (the consumer lab's resolver was migrated in the same change). `.changeset/subtree-descendants.md` was reworded to the per-root contract, and a separate minor changeset records the break.
- **Pairing risk, not closed here.** Expanding into `multi_root` hands the model several placeholders. The tenant guardrail passes a table when its column name or any placeholder appears anywhere in the statement, so it doesn't check that `:tenant_client_ids` is compared with a client column and not `orders.agency_id` (#315; deterministic predicate rewriting is #235). A model that pairs a placeholder with another root's column can still return another tenant's rows, as it already could with a hand-built `multi_root` scope. This decision narrows that risk through the prompt (explicit per-placeholder column lists, tested at the prompt builder) but doesn't eliminate it. Closing it is #315's job.
- **Empty levels fail closed, not empty.** A root with no IDs in the subtree has no placeholder value, so SQL using it throws `UNRESOLVED_TENANT_PLACEHOLDER` instead of returning zero rows. An empty-set rendering in the substituter would change that; it is deferred.
- **AskDB trusts the host's IDs.** It checks that each ID is filed under a root the subtree can contain, not that the ID really is a descendant. Authorization stays the host's job.
- **#268 (built-in recursive-CTE expansion) inherits this model.** A CTE over `<rootTable>` alone only covers the same-table tree. For a multi-table hierarchy it must produce one closure per level (each child level filtered by its foreign key to the previous level's closure), each substituted into that level's own placeholder, never unioned into the root's.
- **#238 (self-referencing roots) is compatible.** A same-table tree's descendants already go under `tenantRoot`; declaring the self-reference in the policy wouldn't change the resolver's shape.

## Related

- #338 — the leak, the options, and the maintainer's decision. Plan 054 (`plans/054-implement-subtree-tenant-scope.md` at `c352d5e`) first proposed the per-root expansion.
- #270 / #232 — the flat-list resolver this supersedes.
- #315, #235 — the guardrail doesn't prove a predicate filters with the right root's IDs.
- #268, #238 — built-in expansion and self-referencing roots.
- `docs/contracts/tenant-policy.md` § Subtree expansion.
