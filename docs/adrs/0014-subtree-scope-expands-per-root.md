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

Rejected. It is the leak. It is only correct when every ID in the subtree belongs to the scope's root table, which holds for a same-table tree (`agencies.parent_agency_id`) but not for the multi-table hierarchy the policy actually declares.

### A′. Same-root IDs only: one placeholder, descendants reached by joins

Keep the flat resolver, but define its result as IDs of the scope's root only: the seeds plus same-table descendants. There are no child-level placeholders. A P4 descendant row is still reachable by joining up the declared foreign keys to the root: #338's B1/B2 cases (`appointments → clients → sub_agencies WHERE s.agency_id IN (:tenant_agency_ids)`) returned exactly the right tenant's rows. This is option 2 of #338 without the refusal.

- **For:** one placeholder in front of the model, so there is nothing to mispair between levels, and no breaking change to #270's type.
- **Against:** every query on a descendant level needs a join chain up to the scope root that the prompt doesn't spell out. A table's declared `scopeThrough` path often ends at a child root (`appointments` is scoped through `clients`), so the chain the model must write isn't the path the policy declares, and the guardrail only checks declared paths, heuristically. The model still sees child roots' columns, so pairing the one placeholder with a child column (`c.id IN (:tenant_agency_ids)`) is still possible (#338's "Related" case).

### B. The resolver returns IDs per root; `ask()` expands the subtree into `multi_root` (chosen)

The resolver returns `Record<rootTableId, string[]>`. `ask()` keeps each root's IDs under that root, so each binds only to that root's own `:tenant_<label>_ids` placeholder. `multi_root` already flows through the prompt, the guardrail and substitution, so no new scope kind is needed. `ask()` never moves an ID from one key to another, so it can't fold one root's IDs into another root's placeholder. That holds as long as each root derives a distinct placeholder. Two labels like `Agency` and `agency` would share one, and substitution would bind the later root's IDs where the earlier root's column is compared. So a colliding policy is rejected when it loads (`normalizeTenantPolicy`), and again in `validateTenantScope()` for a policy built in code. That protects every scope kind, not just expanded subtrees.

- **For:** each table can be filtered on its own declared scope path with its own root's IDs, with no join chains beyond what the policy declares.
- **Against:** N placeholders in front of the model, which must pair each one with the right column. When this option was chosen, nothing checked that pairing: the tenant guardrail passed a table when its column name or any placeholder appeared anywhere (#315), so `orders.agency_id IN (:tenant_client_ids)` passed. #341 (stage (a) of ADR 0010's plan) now checks the pairing within the limits listed under Consequences. The prompt also lists each placeholder's columns.
- **Cost:** a breaking change to the `ResolveTenantDescendants` return type. That is acceptable because #270 is unreleased (`.changeset/subtree-descendants.md` was still pending) and AskDB is pre-1.0.

**Why B over A′.** The maintainer chose option 1 on #338. A′ swaps the pairing risk for an unguided-join risk; when this was decided, both landed on the model because #315 was open. B keeps each query on the scope paths the policy declares. It also makes the expanded scope a normal `multi_root`, so #341's guardrail checks expanded subtrees with no special case, and #235's rewriting will too. A′ would still need every descendant query proved through a join chain the policy doesn't declare.

### C. Refuse `subtree` when the scope's root has child roots

`ask()` would throw `SUBTREE_NOT_RESOLVABLE` for any root with child roots, so a P4 hierarchy never reaches the folding path. Hosts would use `ids` on the top root and join up to it, or build `multi_root` themselves. Smallest change, and the same-table case keeps working.

Rejected by the maintainer: it leaves the access kind the policy's hierarchy exists for unusable on exactly the hierarchies the policy can declare, and pushes every host to hand-build the per-root expansion that option B does once, in core.

## Decision

- **Resolver shape.** `ResolveTenantDescendants = (tenantRoot, seedIds) => TenantIdsByRoot | Promise<TenantIdsByRoot>`, where `TenantIdsByRoot = Readonly<Record<string, readonly string[]>>` (both exported from `@askdb/core`). Keys are root table IDs from the policy. Under `tenantRoot` go the seeds and any same-table descendants; under each descendant root go that root's own IDs.
- **Allowed keys.** `tenantRoot` and every root reachable from it through `roots[].parent` or `hierarchy[]` edges, breadth-first (`subtreeRootIds` in `packages/core/src/sql/tenant-hierarchy.ts`). The resolver receives only `tenantRoot` and the seeds, not the list of levels; the error message for a bad key lists the allowed keys. Passing the levels to the resolver can be added later without breaking it.
- **Expansion.** `ask()` unions the seeds into the `tenantRoot` entry and produces `{ kind: "multi_root", scopes }` with one entry per covered level, in level order, or the equivalent `{ kind: "ids" }` when the subtree is `tenantRoot` alone. That keeps the prompt for a same-table tree byte-identical to an `ids` scope.
- **Empty levels stay in the scope.** A covered level the resolver returns no IDs for stays in the `multi_root` scope with `ids: []`. The guardrail then checks a read of that root on its own placeholder, and binding that placeholder throws `UNRESOLVED_TENANT_PLACEHOLDER`. The first version dropped empty levels, and the #375 review found that this left them *less* restricted than a level with IDs: nothing checked a read of the dropped root, so `clients WHERE sub_agency_id IN (:tenant_sub_agency_ids)` returned its rows. There were two clean options:
  - **(1, chosen)** keep the level in the scope with no IDs;
  - **(2)** pass the covered-root set to the guardrail separately.

  (1) was chosen because the scope stays the single description of access that the prompt, the guardrail, binding and a custom `AskDialect` all read, and no guardrail signature changes. (2) would add a second input to `validateTenantGuardrails()`/`enforceTenantGuardrails()` that every caller must keep in step with the scope. The cost of (1) is that a `multi_root` scope can now carry an empty `ids` list. So the scope schema (`tenantScopeSchema`, used by `validateTenantScope()`) now allows an empty list per entry, and requires at least one ID across the scope. A custom `AskDialect` that validates the scope it gets accepts the expansion, and a host expanding by hand can express an empty level. The fail-closed guarantee for reads through a parent's key or an ancestor holds under `enforcement: strict`; under `warn` such a read is returned with a warning, and only the empty level's own placeholder still fails at binding. The expansion runs before generation, so the prompt, the guardrail and substitution all see the per-root scope.
- **Fail closed** with `TenantScopeError` reason `SUBTREE_NOT_RESOLVABLE`, before the model is called: no resolver; an array result (the old flat shape, with a message that shows the per-root shape to migrate to); a non-object result (`null`, a `Map`); a key that isn't a tenant root in the policy, or a root outside this subtree; a value that isn't an array of non-empty strings; no IDs at all. The flat shape is rejected, not accepted with a warning: accepting it is the leak. A placeholder for a root with no IDs keeps throwing `UNRESOLVED_TENANT_PLACEHOLDER`.
- **Distinct placeholders.** Each root must derive a distinct `:tenant_<name>_ids` placeholder, and the per-root binding above depends on this invariant. One function, `placeholderForTenantRoot(root)` (exported), derives it for the prompt, substitution, the guardrail and the check. `<name>` is the label lowercased, with runs of characters other than ASCII letters and digits turned into `_`. A label with no ASCII letter or digit (e.g. Cyrillic or CJK), which would otherwise reduce every such root to `:tenant___ids`, uses the root's table name instead. Labels that already have an ASCII letter or digit keep their placeholder. The public label-only `placeholderForRoot(label)` is kept, deprecated, with its old output, so existing callers get the same result as before. Two setups that work on `main` do change, and both fail closed with an error. A lone root labelled without ASCII letters or digits gets a new placeholder name, so SQL or code that still uses `:tenant___ids` throws `UNRESOLVED_TENANT_PLACEHOLDER`. A non-ASCII label whose table name matches another root's label now fails at load with `SchemaParseError`. To migrate, use the new placeholder name (the root's table name, or give the root an ASCII label), or rename one of the colliding labels. When two roots still collide, `normalizeTenantPolicy` throws `SchemaParseError` naming both roots. `validateTenantScope()` repeats the check for a policy that never went through the loader, and `resolvePlaceholders` (so `resolveTenantSql()`) repeats it where the IDs bind, for a policy built in code or changed after validation. Studio runs the loader's validation before saving a policy, so it never writes one it can't load.
- **Read the result once.** The resolver's result is snapshotted with one `Object.entries` pass, and each array is copied, before it is validated. The scope is built from that snapshot, so a getter or a non-enumerable property can't slip a value past validation.
- **Prompt pairing.** When the policy has more than one root, the `multi_root` block, and the `ids` block too, lists under each placeholder the columns that hold that root's IDs: its `tenantIdColumn`, child roots' foreign keys to it, scoped tables' direct columns, and polymorphic ID columns with the discriminator value that maps to it. It adds "never compare one root's placeholder with another root's column", and, for `multi_root`, that every listed root table the query reads must be filtered with its own placeholder (the guardrail checks each root the scope names). Join-path tables are left to the existing join-path lines, which filter on the root's own column after the join. `buildTenantPromptBlock()` and `resolveTenantSql()` reject an unexpanded `subtree` rather than render or bind the root's placeholder alone.
- **Owner.** All of this is in `@askdb/core`. `@askdb/client` only forwards the resolver (`AskOverrides` is derived from `ask()`'s options). Studio builds no `subtree` scope (it has no resolver to pass), and the HTTP API takes no tenant scope.

## Consequences

- **Breaking for resolvers written against #270.** A resolver returning `string[]` now throws, with a message naming the per-root shape. #270 never shipped, so the only callers are in this repository (the consumer lab's resolver was migrated in the same change). `.changeset/subtree-descendants.md` was reworded to the per-root contract, and a separate minor changeset records the break.
- **Placeholder pairing is checked by #341, with its limits.** Expanding into `multi_root` hands the model several placeholders. This ADR first recorded that nothing checked their pairing (#315). #341 fixed #315: under `enforcement: strict` the tenant guardrail now runs on the model's SQL before rendering, with placeholders still named, and it requires the following:
  - a scoped table's tenant column compared with *its own root's* placeholder, in a filtering conjunct;
  - on a join path, a column that carries the IDs of the path's root or an ancestor;
  - on a polymorphic table, a discriminator that picks the root whose placeholder filters its id column;
  - on every root table the scope names, a predicate on its own ID column or a column that carries its IDs.

  Expanded subtrees are covered with no special case, because an expanded subtree is an ordinary `multi_root` scope. `orders.agency_id IN (:tenant_client_ids)`, `owner_type = 'agency' AND owner_id IN (:tenant_client_ids)` and `c.id IN (:tenant_agency_ids)` are all rejected (tested in `ask.test.ts`, "rejects … under an expanded subtree").

  The expansion also closes one of #341's limits for subtrees. #341 checks only the roots the scope *names*, not roots reached through the hierarchy. An expanded subtree names every covered level, including one with no IDs, so those roots are checked too.

  The consequence: filtering a covered child root only through its parent's foreign key (`clients.sub_agency_id IN (:tenant_sub_agency_ids)`) or a joined ancestor no longer satisfies the check. For example, `appointments ⋈ clients ⋈ sub_agencies WHERE s.agency_id IN (:tenant_agency_ids)` is rejected; each covered root the query reads needs its own placeholder. This fails closed, and the prompt tells the model.

  #341's remaining limits still apply. Within one query block, a predicate isn't tied to a particular table reference, so an unfiltered or mispaired reference next to a filtered one can pass. Under `multi_root` the mispaired case is the one that matters: a scalar subquery on `clients` compared with `:tenant_agency_ids`, beside a read of `clients` filtered with `:tenant_client_ids`, passes and binds an agency ID against a client column. A predicate in a CTE or derived table can also satisfy the check for an outer read (#399). Joined scoped tables aren't checked for sharing a scope. The sound boundaries stay database-side row-level security and the host's read-only role, and #235 (deterministic rewriting) is the planned next step.
- **Empty levels fail closed, not empty.** A covered root with no IDs in the subtree can't be read. The guardrail requires its own placeholder, and that placeholder has no value, so SQL that uses it throws `UNRESOLVED_TENANT_PLACEHOLDER` instead of returning zero rows. An empty-set rendering in the substituter would change that; it is deferred.
- **AskDB trusts the host's IDs.** It checks that each ID is filed under a root the subtree can contain, not that the ID really is a descendant. Authorization stays the host's job.
- **#268 (built-in recursive-CTE expansion) inherits this model.** A CTE over `<rootTable>` alone only covers the same-table tree. For a multi-table hierarchy it must produce one closure per level (each child level filtered by its foreign key to the previous level's closure), each substituted into that level's own placeholder, never unioned into the root's.
- **#238 (self-referencing roots) is compatible.** A same-table tree's descendants already go under `tenantRoot`; declaring the self-reference in the policy wouldn't change the resolver's shape.

## Related

- #338 — the leak, the options, and the maintainer's decision. Plan 054 (`plans/054-implement-subtree-tenant-scope.md` at `c352d5e`) first proposed the per-root expansion.
- #270 / #232 — the flat-list resolver this supersedes.
- #315 / #341 — the guardrail now requires a predicate that filters with its own root's placeholder; #235 — deterministic rewriting, the planned next stage.
- #268, #238 — built-in expansion and self-referencing roots.
- `docs/contracts/tenant-policy.md` § Subtree expansion.
