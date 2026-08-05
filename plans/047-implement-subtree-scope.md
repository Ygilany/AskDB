# Plan 047: Make `subtree` tenant access actually include descendants

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/core/src/sql/tenant-placeholders.ts packages/core/src/sql/tenant-prompt.ts packages/core/src/schema/v2/tenant-policy.ts packages/core/src/ask.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — this changes which rows a tenant-scoped query returns. Getting it wrong in either direction is serious: too few rows is a visible outage, too many is a cross-tenant data leak.
- **Depends on**: plan 046 (soft). 046 fixes marker generation and fail-closed behavior in the same file; landing it first avoids conflicts and means this plan builds on corrected substitution. Not a hard blocker.
- **Category**: bug
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: **Yes, behaviorally.** Any caller using `access.kind: "subtree"` today receives rows for the named IDs only. After this plan they receive rows for the whole subtree — which is what they asked for, but it is a change in returned data and must be called out prominently.

## Why this matters

`TenantAccessSubtree` is the access kind for hierarchical tenancy: a state administrator scoped to one state who should see every county beneath it, a university dean who should see every department in their college. It is the motivating case for the whole hierarchy half of the tenant policy model.

It does not work. The descendant set is never computed. A caller passing `{ kind: "subtree", tenantRoot: "…agencies", rootIds: ["state-1"], includeDescendants: true }` gets SQL filtered to exactly `state-1` and sees zero county rows.

Worse, it fails silently and in the direction that looks like a data problem rather than a bug: the query runs, returns a small result, and nothing indicates the subtree was never expanded. The type signature actively advertises the capability — `includeDescendants` is typed as the literal `true`, so it cannot even be set to `false`.

Everything needed to implement it is already collected in the policy. It is simply never read.

## Current state

### The unexpanded switch — `packages/core/src/sql/tenant-placeholders.ts:91-110`

```ts
function buildIdsByRoot(access: TenantAccess): Map<string, string[]> {
  const m = new Map<string, string[]>();
  switch (access.kind) {
    case "ids":
      m.set(access.tenantRoot, access.ids);
      break;
    case "subtree":
      m.set(access.tenantRoot, access.rootIds);
      break;
    case "multi_root":
      for (const s of access.scopes) {
        const existing = m.get(s.tenantRoot) ?? [];
        m.set(s.tenantRoot, [...existing, ...s.ids]);
      }
      break;
    case "global":
      break;
  }
  return m;
}
```

`case "subtree"` is identical to `case "ids"`. That single line is the bug.

### The type that advertises the capability — `packages/core/src/schema/v2/tenant-policy.ts:110-115`

```ts
export type TenantAccessSubtree = {
  kind: "subtree";
  tenantRoot: string;
  rootIds: string[];
  includeDescendants: true;
};
```

### The hierarchy data that is collected but never read at query time

`packages/core/src/schema/v2/tenant-policy.ts:7-23`:

```ts
const tenantRootParentSchema = z.strictObject({
  root: z.string().min(1),
  foreignKey: z.string().min(1),
});

export const tenantRootSchema = z.strictObject({
  id: z.string().min(1),
  tenantIdColumn: z.string().min(1),
  label: z.string().min(1),
  parent: tenantRootParentSchema.optional(),
});

export const hierarchyEdgeSchema = z.strictObject({
  parent: z.string().min(1),
  child: z.string().min(1),
  foreignKey: z.string().min(1),
});
```

`NormalizedTenantPolicy.hierarchy` is populated by the loader (`packages/core/src/schema/v2/tenant-policy-loader.ts:220`: `hierarchy: fm.hierarchy ?? [],`), validated for unknown roots (lines 103-127) and for cycles (lines 128-131, via `detectHierarchyCycles`). Then nothing reads it.

Confirm for yourself:

```bash
grep -rn "\.hierarchy" packages/core/src --include=*.ts | grep -v "\.test\." | grep -v "schema/v2/tenant-policy"
```

At `595182d` the only hits are the serializer (`schema/v2/writer.ts:46`), barrel re-exports, and a prompt *heading*. No query-time reader.

### The prompt already promises the behavior — `packages/core/src/sql/tenant-prompt.ts:77-83`

```ts
    case "subtree": {
      const rootLabel = policy.roots.find((r) => r.id === access.tenantRoot)?.label ?? access.tenantRoot;
      const placeholder = `:tenant_${rootLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_ids`;
      lines.push(`  Access: ${rootLabel} subtree from IDs = ${placeholder} (include all descendants)`);
      lines.push(`  Use ${placeholder} as the parameter placeholder for tenant predicates.`);
      break;
    }
```

The model is told to "include all descendants" but is given only the ancestor IDs and is never told which foreign key to recurse on. There is no way for it to comply.

### Where the scope reaches the substitution path — `packages/core/src/ask.ts:333-345`

```ts
  if (tenantPolicy && options.tenantScope) {
    const tenantMode = options.tenantSqlMode ?? "sql-only";
    const paramStartIndex =
      tenantMode === "sql-params" && result.params ? businessParamCount + 1 : 1;
    const resolved = resolveTenantSql(
      result.sql,
      tenantPolicy,
      options.tenantScope,
      tenantMode,
      paramStartIndex,
      dialectSpec,
    );
```

`ask()` is already `async`, so an asynchronous descendant resolver can be threaded here. `resolveTenantSql` is currently synchronous — Step 3 addresses that.

### Conventions

- `AskPipelineOptions` is the options bag for `ask()`; see `packages/core/src/ask.ts` for how optional dependencies are declared and documented.
- Errors use `TenantScopeError` with a `TenantScopeRejectionReason` from `packages/core/src/errors.ts`.
- Tests colocate; `packages/core/src/sql/tenant-placeholders.test.ts:61` already contains a `subtree` fixture.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Placeholder tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-placeholders.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Approach — read this before starting

There are two ways to expand a subtree, and this plan ships them in order of increasing risk. **Steps 1–4 alone fully fix the bug** for hosts willing to supply a resolver. Steps 5–6 add a built-in default. If you run out of confidence, stopping after Step 4 leaves the system strictly better and honest.

**A. Host-supplied resolver (Steps 1–4).** The caller passes a callback that expands ancestor IDs to the full descendant set. The host already knows its own hierarchy, often has it cached, and can apply its own authorization rules. AskDB stays out of the business of querying the database — which is consistent with the rest of its design, since AskDB never opens a connection.

**B. Built-in recursive CTE (Steps 5–6).** AskDB emits a recursive CTE that expands the subtree in-database, using the parent foreign key from the policy. No host code required, but it is dialect-specific and it changes the shape of the generated SQL.

Critically: **when neither is available, throw.** The current silent under-scoping is the worst behavior, and it must not survive this plan under any configuration.

## Scope

**In scope**:
- `packages/core/src/sql/tenant-placeholders.ts`
- `packages/core/src/sql/tenant-hierarchy.ts` (create) — closure resolution
- `packages/core/src/sql/tenant-hierarchy.test.ts` (create)
- `packages/core/src/sql/tenant-placeholders.test.ts`
- `packages/core/src/ask.ts` — thread the resolver option
- `packages/core/src/ask.test.ts`
- `packages/core/src/errors.ts` — one new `TenantScopeRejectionReason`
- `packages/core/src/index.ts` — export the new option type
- `packages/core/src/sql/tenant-prompt.ts` — only if Step 6 lands
- `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`, `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`
- `.changeset/subtree-descendants.md` (create)

**Out of scope** (do NOT touch):
- The `ids`, `multi_root`, and `global` access kinds. Only `subtree` changes.
- `packages/core/src/schema/v2/tenant-policy-loader.ts`. Cycle detection and hierarchy validation already exist there and work; you are a consumer.
- The tenant guardrail (plan 045) and marker generation (plan 046).
- Studio UI. Plan 051 handles authoring; this is the engine.
- Caching descendant lookups. Tempting and out of scope — the resolver callback lets hosts cache, which is where caching belongs.

## Git workflow

- Branch: `advisor/047-implement-subtree-scope`
- One commit per step. This is the highest-risk plan in the set and the history must be bisectable.
- Commit style e.g. `feat(core): expand subtree tenant scope to descendants`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the closure resolver over policy hierarchy

Create `packages/core/src/sql/tenant-hierarchy.ts`.

The policy expresses parentage two ways and both must be honored:

- `TenantRoot.parent` — `{ root, foreignKey }` on a root, meaning "this root's rows hang off that root".
- `HierarchyEdge[]` — explicit `{ parent, child, foreignKey }` entries.

Export a function that, given a `NormalizedTenantPolicy` and a root id, returns the parent linkage needed to walk downward — the child root id and the foreign key column joining child to parent:

```ts
/**
 * Resolve how rows of `rootId` are reached from their parent root, combining
 * `TenantRoot.parent` declarations and explicit `hierarchy` edges.
 *
 * Returns `undefined` when the root has no parent linkage — a flat tenancy,
 * where a subtree is just the named IDs.
 */
export function parentLinkageFor(
  policy: NormalizedTenantPolicy,
  rootId: string,
): { parentRoot: string; foreignKey: string } | undefined;
```

Also export a pure, in-memory closure function that both later steps will use and that is trivially testable:

```ts
/**
 * Expand `seedIds` to include every descendant reachable through `childrenOf`.
 * Breadth-first with a visited set, so a cyclic hierarchy terminates instead
 * of hanging. Returned IDs are unique and include the seeds.
 */
export function expandClosure(
  seedIds: readonly string[],
  childrenOf: (id: string) => readonly string[],
): string[];
```

The cycle guard is not optional. `detectHierarchyCycles` in the loader only *warns*; a warned-but-loaded policy still reaches this code, and an unguarded walk would hang the process.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Add the resolver option to `ask()`

Add an optional dependency to `AskPipelineOptions` in `packages/core/src/ask.ts`:

```ts
  /**
   * Expands a `subtree` tenant scope to the full descendant set.
   *
   * Called with the tenant root id and the seed IDs from
   * `tenantScope.access.rootIds`; must return every ID in the subtree,
   * including the seeds. The host is the right place for this: it already
   * knows its own hierarchy, can cache the closure, and can apply its own
   * authorization rules.
   *
   * Required when `tenantScope.access.kind === "subtree"` unless
   * `tenantSubtreeStrategy: "recursive-cte"` is set — AskDB never opens a
   * database connection of its own. Without either, `ask()` throws rather
   * than silently scoping to the seed IDs alone.
   */
  resolveTenantDescendants?: (
    tenantRoot: string,
    seedIds: readonly string[],
  ) => Promise<readonly string[]> | readonly string[];
```

Export the callback type from `packages/core/src/index.ts`.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 3: Resolve the closure before substitution, and fail closed without it

`resolveTenantSql` is synchronous and `buildIdsByRoot` is a pure function of `access`. Rather than making the whole substitution path async, resolve the expanded IDs **in `ask()`, before calling `resolveTenantSql`**, and pass a scope whose access has already been expanded.

In `packages/core/src/ask.ts`, immediately before the `resolveTenantSql` call at line 337:

1. If `options.tenantScope.access.kind !== "subtree"`, change nothing.
2. If it is `subtree` and `options.resolveTenantDescendants` is set: await it, validate the result is a non-empty array of strings, and build an effective scope with `access` replaced by `{ kind: "ids", tenantRoot, ids: expanded }`.
3. If it is `subtree`, no resolver is set, and the built-in strategy is not enabled: **throw** `TenantScopeError` with a new reason `SUBTREE_NOT_RESOLVABLE` and a message naming the root and both remedies.

Add the reason to `TenantScopeRejectionReason` in `packages/core/src/errors.ts`.

Two subtleties to get right:

- **The resolver must return the seeds too.** If a host returns only strict descendants, the ancestor's own rows vanish. Rather than trusting it, union the seeds into the result inside `ask()` and document that the union happens.
- **An empty resolver result is an error, not an empty scope.** Returning `[]` would produce `IN ()` or, after plan 046, an `UNRESOLVED_TENANT_PLACEHOLDER` throw. Validate explicitly and throw a message that names the resolver as the cause.

Leave `buildIdsByRoot`'s `case "subtree"` in place but make it unreachable-by-contract, and add a comment saying the expansion happens upstream in `ask()`. Direct callers of `resolveTenantSql` (it is exported) still hit the old behavior — so also add a note to its JSDoc that a `subtree` access must be pre-expanded by the caller.

**Verify**: `pnpm --filter @askdb/core test` → all pass, after updating any existing `subtree` test to supply a resolver.

### Step 4: Tests for the resolver path

Cover in `packages/core/src/sql/tenant-hierarchy.test.ts`:

- `expandClosure` on a three-level chain returns all three levels.
- On a diamond (two parents, one shared child) returns the child once, not twice.
- On a cycle terminates and returns each node once.
- With a `childrenOf` that returns nothing, returns exactly the seeds.
- `parentLinkageFor` reads a `TenantRoot.parent` declaration; reads an explicit `hierarchy` edge; returns `undefined` for a flat root; and — decide and pin the behavior — what happens when both declare a linkage for the same root. Assert whichever precedence you implement and comment why.

Cover in `packages/core/src/ask.test.ts`:

- `subtree` access with a resolver returning `["state-1","county-a","county-b"]` → the emitted SQL/params contain all three.
- `subtree` access with **no** resolver → throws `TenantScopeError` with reason `SUBTREE_NOT_RESOLVABLE`. This is the regression guard for the silent under-scoping this plan exists to eliminate.
- Resolver returning only strict descendants → seeds are still present in the final IDs.
- Resolver returning `[]` → throws, and the message names the resolver.
- `ids` and `multi_root` access are unaffected — no resolver required, behavior byte-identical to before.

**Verify**: `pnpm --filter @askdb/core test` → all pass, at least 12 new cases.

### Step 5 (OPTIONAL): built-in recursive-CTE expansion

Attempt only after Steps 1–4 are green and committed.

Add `tenantSubtreeStrategy?: "resolver" | "recursive-cte"` to `AskPipelineOptions`, defaulting to `"resolver"`. When set to `"recursive-cte"` and the policy provides parent linkage for the root, replace the tenant placeholder with a recursive-CTE subquery instead of a literal ID list — for Postgres roughly:

```sql
WITH RECURSIVE askdb_tenant_closure AS (
  SELECT <tenantIdColumn> FROM <rootTable> WHERE <tenantIdColumn> IN (<seed markers>)
  UNION
  SELECT c.<tenantIdColumn> FROM <rootTable> c
  JOIN askdb_tenant_closure p ON c.<foreignKey> = p.<tenantIdColumn>
)
```

Before writing any of it, confirm the syntax for **every** dialect in `DialectId` (`postgres`, `cockroachdb`, `mysql`, `mariadb`, `sqlite`, `sqlserver`). SQL Server does not use the `RECURSIVE` keyword; MySQL requires 8.0+; MariaDB differs from MySQL. Where you cannot confirm a dialect from first-party documentation, **do not guess** — restrict the strategy to the dialects you verified and throw a clear "not supported for this dialect, supply `resolveTenantDescendants`" error for the rest.

Also consider composition: the generated SQL may already contain a `WITH` clause from the model. Injecting a second one requires merging, not prepending. If that turns out to be non-trivial, that is a legitimate reason to stop — record it.

**Verify**: dialect-specific tests for each dialect you implemented; an explicit "unsupported dialect" test for each you did not.

### Step 6: Prompt, docs, and changeset

If Step 5 did **not** land, correct the prompt at `packages/core/src/sql/tenant-prompt.ts:80`. Telling the model to "include all descendants" is misleading when expansion happens outside the model — the model should simply filter on the placeholder, which now carries the full set. Change it to match the `ids` wording.

If Step 5 **did** land, the prompt still should not ask the model to build the recursion; AskDB does that. Same correction applies.

Update `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`, and `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`: document `resolveTenantDescendants` with a worked example for the state/county case, state that `subtree` throws without it, and — if Step 5 landed — document the strategy option and its supported dialects.

Create `.changeset/subtree-descendants.md` — **minor** for `@askdb/core`. The body must lead with the behavior change: `subtree` scopes previously returned only the named IDs; they now include descendants. State that `subtree` without a resolver now throws instead of silently under-scoping, show the resolver signature, and note the new error reason.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

Steps 4 and 5 enumerate the cases. Use `packages/core/src/sql/tenant-placeholders.test.ts` as the structural pattern for unit tests and `packages/core/src/ask.test.ts` for integration.

The two cases that matter most: **no resolver throws** (proves the silent under-scoping is gone) and **seeds are unioned in** (proves an ancestor never loses access to its own rows). Everything else is secondary.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0 with at least 12 new cases
- [ ] `pnpm docs:build` exits 0
- [ ] `grep -n "SUBTREE_NOT_RESOLVABLE" packages/core/src/errors.ts` returns a match
- [ ] `packages/core/src/sql/tenant-hierarchy.ts` exists and exports `expandClosure` and `parentLinkageFor`
- [ ] A test asserts that `subtree` access without a resolver throws
- [ ] A test asserts closure expansion terminates on a cyclic hierarchy
- [ ] `grep -n "resolveTenantDescendants" packages/core/src/index.ts` returns a match
- [ ] `git diff --name-only packages/core/src/schema/v2/tenant-policy-loader.ts` is empty
- [ ] `grep -n "include all descendants" packages/core/src/sql/tenant-prompt.ts` returns no matches
- [ ] `.changeset/subtree-descendants.md` exists and leads with the behavior change
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- An existing test or example depends on `subtree` returning only the seed IDs in a way that suggests some caller is relying on today's behavior deliberately. Report it before changing.
- You cannot determine a defensible precedence when a root has both a `parent` declaration and a conflicting `hierarchy` edge. Report both options with a recommendation; do not pick silently.
- In Step 5, you cannot confirm recursive-CTE syntax for a dialect from first-party documentation. Restrict the strategy and throw for that dialect — never guess SQL syntax into a security path.
- In Step 5, merging AskDB's CTE with a model-generated `WITH` clause turns out to need real SQL parsing. Stop after Step 4; the resolver path already fixes the bug.
- Threading the resolver forces `resolveTenantSql` to become async and that ripples into more than two call sites. Step 3 is designed to avoid this by expanding in `ask()`; if it does not, report why.
- You find another caller of `buildIdsByRoot` outside this file that would bypass the Step 3 expansion.

## Maintenance notes

- **`buildIdsByRoot`'s `case "subtree"` becomes a trap after this plan.** It still returns seeds only, and it is only correct because `ask()` pre-expands. `resolveTenantSql` is exported, so a direct caller can still hit the old behavior. The JSDoc note from Step 3 is the mitigation; the durable fix is to make `resolveTenantSql` reject an unexpanded `subtree` access outright — worth doing once no internal caller passes one.
- **`includeDescendants: true` is now redundant.** It was always a literal type with one possible value. Once the resolver path is established, consider removing it from `TenantAccessSubtree` in a follow-up — deferred here because it is a separate breaking type change and this plan is already behavioral.
- **If Step 5 lands, every new dialect added to `DialectId` needs a recursive-CTE decision.** Make the unsupported-dialect throw the default so a new dialect fails loudly rather than silently under-scoping.
- **Reviewer focus**: confirm the seeds-union happens inside `ask()` and is not merely documented as the resolver's responsibility, and confirm the cycle guard is a visited set rather than a depth limit.
