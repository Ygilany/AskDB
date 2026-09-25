# Plan 054: Implement `subtree` tenant scope: expand descendants per root, with a host resolver

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index. This plan **supersedes plan 047**. Read 047 for background, but where they differ, follow this plan.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
>
> ```bash
> gh pr view 186 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> gh pr view 197 --repo Ygilany/AskDB --json state -q .state   # → MERGED
> git grep -n 'subtreeUnsupportedError' -- packages/core/src   # → matches in tenant-placeholders.ts, tenant-prompt.ts, tenant-scope-validate.ts (subtree is still rejected)
> git grep -n '"UNSUPPORTED_ACCESS_KIND"' -- packages/core/src/errors.ts   # → 1 match
> git grep -n 'Only reachable from a saved history entry' -- apps/studio/src/web/contexts/playground-context.tsx  # → 1 match (Studio button still removed)
> ```

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH. This changes which rows a tenant-scoped query covers. Too few rows is an outage. Too many is a cross-tenant leak.
- **Depends on**: #186, #197 (merged). Plan 053 is soft: land it first or keep the tests' explicit `tenantSqlMode`. Supersedes plan 047.
- **Category**: bug
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: **No for correct callers, minor for error matchers.** `subtree` goes from "always rejected" to "accepted when a resolver is supplied" (additive). Without a resolver it still throws, but the reason changes from `UNSUPPORTED_ACCESS_KIND` to the new `SUBTREE_NOT_RESOLVABLE`. Ship as a minor changeset.

## Why this matters

`TenantAccessSubtree` (`{ kind: "subtree", tenantRoot, rootIds, includeDescendants: true }`) is the access kind for hierarchical tenancy: an agency admin who should see every sub-agency and client beneath their agency. It's the reason the policy has `roots[].parent` and `hierarchy[]`. Before #197 it was accepted and silently bound only `rootIds`. #197 made it fail closed everywhere and removed Studio's Subtree button. This plan makes it work.

**Correction to plan 047's design (read this).** Plan 047 had a resolver return one flat ID list and rewrote the scope to `{ kind: "ids", tenantRoot, ids: expanded }`. In the tenant-policy contract (`docs/contracts/tenant-policy.md`, "P4: Multi-level hierarchy"), descendants live in **different root tables with their own ID spaces and placeholders**. Agencies are the parent of sub-agencies, which are the parent of clients (`:tenant_agency_ids`, `:tenant_sub_agency_ids`, `:tenant_client_ids`). Merging sub-agency or client IDs into the agency root would compare them against `orders.agency_id`, and any ID collision across tables is a cross-tenant leak. This plan expands a subtree into **per-root ID sets**, which is exactly a `multi_root` scope, and every downstream path (prompt, substitution, guardrail) already handles `multi_root`.

AskDB never executes SQL (AGENTS.md), so the descendant IDs must come from the host. AskDB owns the part it can do deterministically: traverse the policy hierarchy and tell the host exactly which root tables and foreign keys make up the subtree, in dependency order.

## Current state

- `packages/core/src/sql/tenant-scope-validate.ts` `validateTenantScope` rejects subtree:
  ```ts
    case "subtree":
      // Fail closed: descendants are never expanded, so accepting this would
      // silently scope the query to rootIds only.
      throw subtreeUnsupportedError();
  ```
- `packages/core/src/sql/tenant-placeholders.ts`: `buildIdsByRoot` has `case "subtree": throw subtreeUnsupportedError();`. The error factory lives in the same file:
  ```ts
  export function subtreeUnsupportedError(): TenantScopeError {
    return new TenantScopeError(
      'tenantScope.access.kind "subtree" is not supported yet: ...',
      "UNSUPPORTED_ACCESS_KIND",
    );
  }
  ```
  It is **not** re-exported from `packages/core/src/index.ts`.
- `packages/core/src/sql/tenant-prompt.ts` `buildTenantPromptBlock` has `case "subtree": throw subtreeUnsupportedError();`. Its `multi_root` branch renders `  Access: multiple roots —` and one `    - <Label> IDs = <placeholder>` line per scope (placeholder built inline; plan 055 moves it to `placeholderForRoot`).
- `packages/core/src/ask.ts` `ask()` calls `validateTenantScope(tenantPolicy, options.tenantScope)` first. It then passes `options.tenantScope` to `dialect.generate(...)` (prompt), to `resolveTenantSql(...)` (twice), to `bindTenantIntoUnboundSql(...)` and to `enforceTenantGuardrails(...)`.
- `packages/core/src/errors.ts` `TenantScopeRejectionReason` includes `/** access.kind is declared but not implemented (currently "subtree"). */ | "UNSUPPORTED_ACCESS_KIND"`.
- `packages/core/src/schema/v2/tenant-policy.ts`: `TenantRoot.parent?: { root, foreignKey }` (FK column on the child) and `HierarchyEdge { parent, child, foreignKey }`. `NormalizedTenantPolicy.hierarchy` is populated by `normalizeTenantPolicy` in `tenant-policy-loader.ts`, but hierarchy cycles only produce a `hierarchy_cycle` **warning**, and the policy still loads. The contract says hierarchy edges must form a DAG.
- Fixture: `fixtures/schemas/agency-multi-tenant.schema/tenant-policy.md` declares agencies → sub_agencies (`sub_agencies#agency_id`) → clients (`clients#sub_agency_id`) in both `roots[].parent` and `hierarchy[]`.
- Studio: `apps/studio/src/web/views/playground/PlaygroundPage.tsx` renders IDs / Multi-root / Super-global buttons, with no Subtree button. It still has `(askTenantAccessKind === "ids" || askTenantAccessKind === "subtree")` for the root and IDs fields, labelled `"Subtree root IDs"`. `apps/studio/src/web/contexts/playground-context.tsx` `buildTenantScope` returns an error for `"subtree"`. The server (`apps/studio/src/server.ts` `askSampleQuestion`) calls core `ask()`. Studio can run read-only SQL only when `studio.execute.enabled` is set (`executeQuery`, `EXECUTE_DRIVER_REGISTRY` and `validateExecuteSql` in `apps/studio/src/execute-registry.ts`).
- Tests pinning today's rejection: `tenant-scope-validate.test.ts` ("rejects subtree scope as not yet supported …"), `tenant-prompt.test.ts` ("rejects subtree scope like validateTenantScope"), `tenant-placeholders.test.ts` ("rejects subtree scope instead of binding only the root IDs").

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Core unit tests (one file) | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-subtree.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| SQLite exec suite | `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/sqlite test` | all pass |
| Studio | `pnpm --filter @askdb/studio lint && pnpm --filter @askdb/studio test` | exit 0 |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**: `packages/core/src/sql/tenant-subtree.ts` (create) + `.test.ts` (create); `tenant-scope-validate.ts`, `tenant-placeholders.ts`, `tenant-prompt.ts` and their tests; `packages/core/src/ask.ts` + `ask.test.ts`; `packages/core/src/errors.ts`; `packages/core/src/index.ts`; `packages/sqlite/src/exec/tenant-binding.exec.test.ts`; `apps/studio/src/tenant-subtree-resolver.ts` (create), `apps/studio/src/server.ts`, `apps/studio/src/server.test.ts`, `apps/studio/src/web/contexts/playground-context.tsx`, `apps/studio/src/web/views/playground/PlaygroundPage.tsx`; the docs listed under Docs impact; `.changeset/subtree-tenant-scope.md`.

**Out of scope**:
- Self-referential hierarchies (a root whose parent is itself, e.g. `agencies.parent_agency_id`). The contract calls hierarchy cycles invalid, so this plan throws for them. Supporting them needs a contract change first. Record it as a follow-up.
- A built-in recursive-CTE or subquery strategy (plan 047 Step 5). The resolver path fully fixes the bug. In-SQL expansion interacts with the guardrail and plan 050's rewriting, so leave it for later.
- Removing `includeDescendants: true` from the type. That's a separate breaking type change.
- Removing `UNSUPPORTED_ACCESS_KIND` from the union. It stays, documented as reserved.
- HTTP API subtree support. Plan 056 can pass a resolver later.

## Git workflow

Branch `plan/054-subtree-tenant-scope`; one commit per step; one PR, don't merge. Commit style e.g. `feat(core): expand subtree tenant scope through a host resolver`.

## Steps

### Step 1: Traverse the policy hierarchy (`tenant-subtree.ts`)

Create `packages/core/src/sql/tenant-subtree.ts` exporting:

```ts
export type TenantSubtreeLevel = {
  /** Root table id of this descendant level, e.g. "table:public.clients". */
  rootId: string;
  label: string;
  /** Column id of this root's tenant identifier (what the resolver returns). */
  tenantIdColumn: string;
  /** Incoming edges: rows of `rootId` whose `foreignKey` points at an id of `rootId` in `parents[i].rootId`. */
  parents: Array<{ rootId: string; foreignKey: string }>;
};
export type TenantSubtreePlan = {
  tenantRoot: string;
  rootIds: readonly string[];
  /** Descendant levels in dependency order: every parent appears before its children. Excludes `tenantRoot`. */
  levels: readonly TenantSubtreeLevel[];
};
export function planTenantSubtree(policy: NormalizedTenantPolicy, tenantRoot: string, rootIds: readonly string[]): TenantSubtreePlan;
```

Rules (all fail with `TenantScopeError` reason `SUBTREE_NOT_RESOLVABLE`, added to `errors.ts` with a doc comment):
- Edges are the **union** of `roots[].parent` (`parent.root → root.id`, FK `parent.foreignKey`) and `hierarchy[]` (`parent → child`, FK `foreignKey`). Identical duplicates collapse. If the same `(parent, child)` pair is declared with **different** foreign keys, throw and name both FKs. Don't pick one silently.
- Only roots reachable from `tenantRoot` are included. A child with several reachable parents (a diamond) appears once, with every edge in `parents`.
- A cycle reachable from `tenantRoot` (including a self-edge) throws. The loader only warns, so this is the guard. Use Kahn's algorithm over the reachable subgraph for the order. Leftover nodes mean a cycle.
- `tenantRoot` not in `policy.roots` throws `UNKNOWN_TENANT_ROOT` (match `validateTenantScope`'s message style).
- A root with no children returns `levels: []`. That's valid: the subtree is just the seed IDs.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Expand a subtree scope into `multi_root`

In the same file, add:

```ts
export type TenantSubtreeResolver = (
  plan: TenantSubtreePlan,
) => Promise<Readonly<Record<string, readonly string[]>>> | Readonly<Record<string, readonly string[]>>;

/** Returns `scope` unchanged unless `access.kind === "subtree"`; then returns a `multi_root` scope with the same `context`. */
export async function expandTenantSubtree(policy: NormalizedTenantPolicy, scope: TenantScope, resolver: TenantSubtreeResolver | undefined): Promise<TenantScope>;
```

Contract (JSDoc it):
- No resolver → throw `SUBTREE_NOT_RESOLVABLE`: "…pass `resolveTenantSubtree` to `ask()`, or resolve the subtree yourself and pass `multi_root`."
- The resolver returns IDs **per descendant level `rootId`**. A key that isn't a level `rootId` (including `tenantRoot` itself) throws. That stops a buggy resolver from widening the seed set. Values must be arrays of non-empty strings, otherwise throw. A missing key means the level is empty.
- The result is `multi_root` with `{ tenantRoot, ids: dedupe(rootIds) }` first, then one entry per level **with at least one ID**, in plan order. Seeds always come from the scope, never from the resolver.
- An empty level is omitted. If the model then references that level's placeholder, substitution throws `UNRESOLVED_TENANT_PLACEHOLDER` (existing fail-closed behavior). Say so in the JSDoc. Returning zero rows instead would need an empty-set rendering in the substituter, which is deferred.
- AskDB doesn't verify that the returned IDs really are descendants. Authorizing them is the host's job, the same as `bindPreparedQuery` (say so).

Export `planTenantSubtree`, `expandTenantSubtree`, and the three types from `packages/core/src/index.ts`.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 3: Remove the rejection, and expand once in `ask()`

- `tenant-scope-validate.ts`: the `subtree` case checks `tenantRoot` is known (`UNKNOWN_TENANT_ROOT`), then calls `planTenantSubtree(...)` so a conflicting or cyclic hierarchy fails **before** the model call.
- `tenant-placeholders.ts`: replace `subtreeUnsupportedError` with `subtreeNotExpandedError()` (reason `SUBTREE_NOT_RESOLVABLE`, message: "expand it with `expandTenantSubtree()` first; `ask()` does this when given `resolveTenantSubtree`"). Use it in `buildIdsByRoot`. `tenant-prompt.ts` uses it in its `subtree` case. Update the `resolveTenantSql` and `buildTenantPromptBlock` JSDoc.
- `ask.ts`: add `resolveTenantSubtree?: TenantSubtreeResolver` to `AskPipelineOptions` (JSDoc: required for `subtree` scopes, receives the plan, returns IDs per descendant root; AskDB never queries your database). Right after `validateTenantScope`, compute `const tenantScope = tenantPolicy && options.tenantScope ? await expandTenantSubtree(tenantPolicy, options.tenantScope, options.resolveTenantSubtree) : options.tenantScope;`, and use `tenantScope` everywhere `options.tenantScope` is used below (generate deps, both `resolveTenantSql` calls, `bindTenantIntoUnboundSql`, `enforceTenantGuardrails`). The resolver must run **before** `dialect.generate` so the prompt lists every level's placeholder.
- `tenant-prompt.ts` `multi_root` branch: add the line `  Use the placeholder for the root each table is scoped through.`, so an expanded subtree prompt tells the model how to choose.
- `errors.ts`: update the `UNSUPPORTED_ACCESS_KIND` doc comment to "reserved; no access kind currently uses it".
- `@askdb/client` needs no change: `AskOverrides` is `Omit<AskPipelineOptions, …>` and `...rest` is forwarded. Confirm with `pnpm --filter @askdb/client lint`.

**Verify**: `git grep -n 'subtreeUnsupportedError' -- packages` → no matches; `pnpm --filter @askdb/core test` → the three old rejection tests fail (expected). Update them in Step 4.

### Step 4: Core tests

Apply the test-audit authoring gate (`.agents/skills/test-audit/SKILL.md`). Owners:
- `packages/core/src/sql/tenant-subtree.test.ts` (unit owner of traversal and expansion). Build a policy with `loadSchema(fixtures/schemas/agency-multi-tenant.schema).tenantPolicy!` and small inline variants. Cases:
  - Agency plan has levels `[sub_agencies, clients]` with the right FKs, in order.
  - A diamond child appears once with two `parents`.
  - `roots[].parent` and `hierarchy[]` conflicting FKs throw `SUBTREE_NOT_RESOLVABLE`.
  - A cycle or self-edge throws.
  - A leaf root gives `levels: []`.
  - `expandTenantSubtree` with no resolver throws.
  - A resolver returning an unknown key, the `tenantRoot` key, or a `""` id throws.
  - Empty levels are omitted, and seeds are present even when the resolver returns nothing.
  - A non-subtree scope is returned unchanged.
- Replace the three rejection tests: `validateTenantScope` accepts a subtree on the fixture policy; `buildTenantPromptBlock` and `resolveTenantSql` given an **unexpanded** subtree throw `SUBTREE_NOT_RESOLVABLE`.
- `packages/core/src/ask.test.ts` (pipeline owner). Cases:
  - Subtree + resolver: capture the prompt via the `generateText` mock and assert it contains all three placeholders. The returned SQL binds the client IDs the resolver returned, and `tenantBindings` lists them.
  - Subtree with no resolver throws `SUBTREE_NOT_RESOLVABLE` and `generateText` is never called.
  - A placeholder for an omitted empty level throws `UNRESOLVED_TENANT_PLACEHOLDER`.

  Each of these must fail on the pre-change code: they currently throw `UNSUPPORTED_ACCESS_KIND`.

**Verify**: `pnpm --filter @askdb/core test` → all pass.

### Step 5: Prove it executes (SQLite)

Extend `packages/sqlite/src/exec/tenant-binding.exec.test.ts`. Seed `agencies`, `sub_agencies (id, agency_id)`, `clients (id, sub_agency_id)` and `appointments (client_id, …)` with two agencies. Write a resolver in the test that runs the per-level `SELECT id FROM <table> WHERE <fk> IN (…)` queries on the same better-sqlite3 db, following `plan.levels` order. Ask with `{ kind: "subtree", tenantRoot: "table:public.agencies", rootIds: ["42"], includeDescendants: true }` and a mocked model reply that filters `appointments` by `client_id IN (:tenant_client_ids)`. Assert the count covers exactly agency 42's clients' appointments and none of the other agency's, in both modes. This is the regression that proves no under-scope and no leak.

**Verify**: `ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/sqlite test` → all pass.

### Step 6: Studio: restore the Subtree button with an execute-backed resolver

- Create `apps/studio/src/tenant-subtree-resolver.ts` exporting `createStudioSubtreeResolver(schemaDir): TenantSubtreeResolver`. It reads `getAskDbRuntimeConfig().studio.execute`. `StudioHttpError` is a private class near the bottom of `server.ts`, and `server.ts` will import this file. Don't import from `server.ts` (that's a cycle). Instead, the resolver throws a plain `Error` subclass exported from the new file (e.g. `StudioSubtreeError`), and `askSampleQuestion` maps it to `StudioHttpError(400, message)`. Move `EXECUTE_DISABLED_MESSAGE` and `executeNotConfiguredMessage` from `server.ts` into the new file and import them back into `server.ts`. Don't duplicate the text.

  For each level, in order, the parent ID set is the union of the resolved IDs of every `parents[i].rootId` (the scope root resolves to `plan.rootIds`). Skip the query when that set is empty. Otherwise build one `SELECT <id> FROM <table> WHERE <fk> IN (<markers>)` per parent edge. Parse the stable ids: `table:<schema>.<table>`, and `#<column>` for columns. Quote identifiers with `executeDialectFor(provider, rt.nlToSql.dialect).identifierQuote`, doubling any embedded quote character. Markers are `$1…$n` for postgres and sqlserver (`rewriteSqlServerParams` rewrites `$N` to `@pN`), and `?` for mysql and sqlite.

  Run every query through `validateExecuteSql`, then `EXECUTE_DRIVER_REGISTRY[provider].execute(...)` with `exec.maxRows`. A `truncated: true` result must **throw** ("subtree level <label> exceeds studio.execute.maxRows"), never return a partial set. A partial set is a silent under-scope.
- `apps/studio/src/server.ts` `askSampleQuestion`: when `options.tenantScope?.access.kind === "subtree"`, pass `resolveTenantSubtree: createStudioSubtreeResolver(state.schemaDir)`, and catch `StudioSubtreeError` to rethrow as `StudioHttpError(400, …)`. `TenantScopeError` from core keeps whatever mapping the `/api/ask` handler already applies. Check that mapping and don't change it.
- `playground-context.tsx` `buildTenantScope`: `"subtree"` builds `{ kind: "subtree", tenantRoot, rootIds: ids, includeDescendants: true }` with the same root and IDs validation as `"ids"`. `PlaygroundPage.tsx`: add a `Subtree` button between IDs and Multi-root. Add the field description "Descendants are resolved by running read-only queries through Studio execute."
- `apps/studio/src/server.test.ts`: one case with execute disabled (`/api/ask` with a subtree scope → 400 with the execute-disabled message), and one with the real-SQLite execute setup already used by the `/api/execute` tests (subtree resolves, and the response `tenant.bindings` includes the descendant level).

**Verify**: `pnpm --filter @askdb/studio lint && pnpm --filter @askdb/studio test` → exit 0.

### Step 7: Docs, changeset, release checks

Update the pages under Docs impact: `subtree` is supported with `resolveTenantSubtree`. Include a worked agency → sub-agency → client example showing the plan the resolver receives and the per-root record it returns, plus the empty-level and cycle behavior. `docs/contracts/tenant-policy.md`: the access-kinds row, the enforcement-rules row, and the new reason. Changeset `.changeset/subtree-tenant-scope.md`: `"@askdb/core": minor`, `"@askdb/studio": patch`. Lead with "subtree scopes are now supported through `resolveTenantSubtree`", then the reason change for callers without a resolver.

**Verify**: `pnpm changeset status` → no major bumps. `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

Covered in Steps 4–6. Primary owners: `tenant-subtree.test.ts` (traversal and expansion rules), `ask.test.ts` (resolver wiring, prompt before generation, fail-closed without a resolver), `tenant-binding.exec.test.ts` (rows actually scoped) and `server.test.ts` (Studio wiring only). Don't repeat traversal cases at the ask or Studio layers. If time is short, the highest-value cases are: no resolver throws before the model call, the resolver can't widen the seeds, and the SQLite exec subtree count.

## Docs impact

`apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` (the subtree paragraph after the `access.kind` list), `reference/core-api.mdx` (new option row, access-kinds table, new exports, new rejection reason), `reference/client-api.mdx` (`resolveTenantSubtree` row), `studio.mdx` (Playground subtree needs execute), `docs/contracts/tenant-policy.md`, `docs/specs/multi-tenancy.md` (remove "Subtree expansion" from non-goals and "rejected" wording).

## Done criteria

- [ ] `git grep -n 'subtreeUnsupportedError\|not supported yet' -- packages/core/src apps/studio/src` → no matches
- [ ] `git grep -n 'SUBTREE_NOT_RESOLVABLE' -- packages/core/src/errors.ts` → match
- [ ] `git grep -n 'expandTenantSubtree\|planTenantSubtree' -- packages/core/src/index.ts` → matches
- [ ] Tests exist for: no resolver throws before `generateText`; resolver cannot add seed/unknown keys; cycle and conflicting FK throw; SQLite exec subtree count
- [ ] `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` exit 0; no major bumps

## STOP conditions

- Readiness check fails.
- The fixture or any real policy you find declares a hierarchy where a child's FK points at something other than the parent root's `tenantIdColumn`. The resolver contract assumes it does, so report it.
- Expanding in `ask()` before `dialect.generate` would require changing the `AskDialect` interface. It shouldn't, because `tenantScope` is already in `AskDialectGenerateOptions`.
- Studio's execute path can't run the level queries without bypassing `validateExecuteSql` or the row cap. Stop after Step 5 and report. The core feature stands without Studio.
- Any existing test or doc shows a caller relying on subtree being rejected for a reason other than "not implemented".

## Maintenance notes

- `buildIdsByRoot`'s subtree case and the prompt's subtree case only throw "not expanded". `ask()` is the one place that expands. A future entry point that accepts a `TenantScope` must call `expandTenantSubtree` first.
- A new hierarchy shape (self-referential roots) needs a contract change plus a recursive resolver contract. Don't loosen the cycle check to allow it.
- Reviewer focus: seeds come only from the scope; the resolver can't add keys outside the plan; truncation in Studio throws; the prompt is built from the expanded scope.
- Deferred: in-SQL expansion (subquery or recursive CTE; plan 047 Step 5, and plan 050), empty-level zero-row rendering, and HTTP API resolver support (plan 056 follow-up).
