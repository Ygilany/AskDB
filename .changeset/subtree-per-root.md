---
"@askdb/core": minor
"@askdb/studio": patch
"@askdb/docs-site": patch
---

**Fix a cross-tenant leak in `subtree` scopes (#338): `resolveTenantDescendants` now returns IDs per tenant root.** The resolver returned one flat list, and `ask()` bound every ID to the scope root's placeholder. In a multi-table hierarchy (agencies → sub-agencies → clients), a sub-agency or client ID that equalled another agency's ID matched that agency's rows. The resolver now returns `TenantIdsByRoot` (`Record<rootTableId, string[]>`), and `ask()` expands the subtree into a `multi_root` scope, so each root's IDs bind only to that root's own placeholder. A resolver that still returns an array throws `TenantScopeError` (`SUBTREE_NOT_RESOLVABLE`) with a message showing the per-root shape to return. So does a key that isn't a tenant root in the subtree. Migrate a same-table resolver by returning `{ [tenantRoot]: ids }`. The decision and the options are in `docs/adrs/0014-subtree-scope-expands-per-root.md`.

**The tenant prompt for a `multi_root` scope now pairs each placeholder with its columns.** Under each `:tenant_<label>_ids` line it lists the columns that hold that root's IDs (its own ID column, child roots' foreign keys to it, scoped tables' direct columns, and polymorphic ID columns with their discriminator value), and tells the model never to compare one root's placeholder with another root's column. This changes the prompt bytes for every `multi_root` scope. The tenant guardrail still doesn't check the pairing.

**`buildTenantPromptBlock()` rejects an unexpanded `subtree` scope** with `SUBTREE_NOT_RESOLVABLE`, like `resolveTenantSql()`, instead of rendering only the root's placeholder.

**@askdb/studio**: the playground's message for a saved `subtree` scope now says to use the Multi-root scope with each root's IDs in its own row, not to fold the subtree into the IDs scope.

**@askdb/docs-site**: the multi-tenancy guide, the `ask()` and client references, troubleshooting, and `/AGENTS.md` document the per-root resolver with an agency → sub-agency → client example.
