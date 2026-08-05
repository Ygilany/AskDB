# Plan 052: Make a tenant policy comprehensible in Studio — complete coverage, a hierarchy tree, and scope preview

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- apps/studio/src/web/views/tenancy packages/core/src/schema/v2/tenant-policy.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — read-only presentation. Step 4 is the only part that triggers a backend call, and it reuses an existing endpoint.
- **Depends on**: plan 044 (**hard**, typechecking). Plan 051 (soft) — 051 makes the entities creatable; this plan makes them comprehensible. Landing 051 first is preferable but not required, since everything here reads a policy that AI drafting can already produce.
- **Category**: dx
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No — presentation only.

## Why this matters

A tenant policy is a graph: roots that nest inside other roots, tables that reach a root through a chain of joins, tables that are deliberately global. Studio currently presents it as four flat lists and a percentage.

Three specific things stop a user from knowing whether their policy is right:

**The coverage numbers do not add up.** The panel shows four counts — Root, Scoped, Global, Unknown — but the classifier produces six. Tables classified `inherited` (reached by joining) or `polymorphic` are counted in none of the cards, while the header reports "N% table coverage" computed over all six. On a schema where most tables reach their tenant through joins — which is the normal case — the cards visibly fail to reconcile with the header, and the user has no way to tell whether the difference is a gap in their policy or a gap in the display.

**The hierarchy is shown as an edge list.** For nested tenancy — agencies inside agencies inside a state — a flat list of `table:public.agencies → table:public.agencies` cards with raw ids is close to unreadable. The nesting is the whole point and it is the one thing not shown.

**There is no way to check a scope.** A user can author a policy but cannot answer "if I give this user access to county-3, what will they be able to see?" without leaving Studio, writing code, and running a query. That feedback loop is the difference between authoring a policy and guessing at one.

## Current state

### Coverage: four cards for six classifications

`apps/studio/src/web/views/tenancy/TenancyPage.tsx:100-110` computes the counts:

```tsx
  const coverageByClassification = tenantPolicy.coverage.reduce(
    (acc, entry) => {
      acc[entry.classification] = (acc[entry.classification] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalTables = tenantPolicy.coverage.length;
  const coveredTables = totalTables - (coverageByClassification["unknown"] ?? 0);
  const coveragePct = totalTables > 0 ? Math.round((coveredTables / totalTables) * 100) : 0;
```

Lines 132-140 render only four of them:

```tsx
          <CollapsibleSection title="Coverage">
            <div className="grid-4">
              <CoverageStat label="Root" count={coverageByClassification["root"] ?? 0} variant="primary" />
              <CoverageStat label="Scoped" count={coverageByClassification["scoped"] ?? 0} variant="primary" />
              <CoverageStat label="Global" count={coverageByClassification["global"] ?? 0} variant="secondary" />
              <CoverageStat label="Unknown" count={coverageByClassification["unknown"] ?? 0} variant="warning" />
            </div>
          </CollapsibleSection>
```

The full set — `packages/core/src/schema/v2/tenant-policy.ts:231-243`:

```ts
export type TableTenantClassification =
  | "scoped"
  | "inherited"
  | "polymorphic"
  | "global"
  | "root"
  | "unknown";

export type TableCoverageEntry = {
  tableId: string;
  classification: TableTenantClassification;
  scopeRoots?: string[];
};
```

`inherited` is assigned when a scoped table's path is a join rather than a direct column — see the loader at `packages/core/src/schema/v2/tenant-policy-loader.ts:250`:

```ts
    const classification: TableTenantClassification = hasJoin ? "inherited" : "scoped";
```

Note `TableCoverageEntry.scopeRoots` — which roots a table is reachable from. Already computed, never displayed.

### Hierarchy: a flat edge list — lines 750-769

```tsx
          {tenantPolicy.hierarchy.length > 0 && (
            <CollapsibleSection title="Hierarchy Edges" count={tenantPolicy.hierarchy.length}>
              <div style={{ display: "grid", gap: 8 }}>
                {tenantPolicy.hierarchy.map((edge) => (
                  <div className="card" key={`${edge.parent}-${edge.child}`} style={{ padding: 12, fontSize: 13 }}>
                    <code>{edge.parent}</code>
                    <span className="muted" style={{ margin: "0 8px" }}>&rarr;</span>
                    <code>{edge.child}</code>
                    <div className="muted tiny" style={{ marginTop: 4 }}>FK: {edge.foreignKey}</div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
```

(That excerpt is from `TenancyView`, the read-only overview starting at line 93. The near-identical block in `TenancyReviewDraft` at line 750 is plan 051's territory — **this plan changes only the read-only overview**.)

Parentage comes from two sources: `TenantRoot.parent` (`{ root, foreignKey }`) and the explicit `hierarchy` edges array. A tree renderer must merge both.

### Scope preview: does not exist

The playground has tenant scope inputs and a `tenantScopeJson` preview (`apps/studio/src/web/views/playground/PlaygroundPage.tsx:397-417`), but that shows the scope *object*, not its effect on the schema. Read that code before Step 4 — it already builds and validates a `TenantScope` and is the right thing to reuse.

### Available API

`apps/studio/src/shared/api.ts:36` — the workspace DTO carries `tenantPolicy: NormalizedTenantPolicy | null`, so `coverage`, `warnings`, `roots`, and `hierarchy` are all already in the browser. Steps 1–3 need **no** new backend work.

Step 4 does need SQL generation; `apps/studio/src/shared/api.ts:142-143` shows the ask endpoint already accepts `tenantScope` and `tenantSqlMode`.

### Conventions

- Panels: `section.card` with `card-hd` / `card-bd`; collapsible sections use the local `CollapsibleSection` (line 867).
- `CoverageStat` (line 894) takes `label`, `count`, and `variant: "primary" | "secondary" | "warning"`.
- Layout uses `grid-2` / `grid-4` utility classes from `apps/studio/src/web/styles.css`.
- **If this plan adds any chart or data visualization, invoke the `dataviz` skill first** — see the toolkit section.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Studio typecheck | `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` | exit 0 |
| Studio lint | `pnpm --filter @askdb/studio lint` | exit 0 |
| Studio tests | `pnpm --filter @askdb/studio test` | all pass |
| Run Studio | `pnpm --filter @askdb/studio dev` | Studio loads |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |

## Suggested executor toolkit

- **`dataviz`** — invoke before writing any chart, meter, or stat-tile code. Step 1 touches the coverage stat row, which is a KPI tile group; read the skill before changing it.
- **`react-doctor`** — available for `apps/studio/` files; run it after Step 3 to check the new tree component for accessibility issues, which matter here since a tree needs correct roles and keyboard support.

## Scope

**In scope**:
- `apps/studio/src/web/views/tenancy/TenancyPage.tsx` — the read-only `TenancyView` only
- New component files under `apps/studio/src/web/views/tenancy/` for the tree and the scope preview
- `apps/studio/src/web/styles.css` — tree indentation and connector styling if needed
- `apps/studio/src/web/views/playground/PlaygroundPage.tsx` — only if Step 4 places the preview there
- `.changeset/studio-tenancy-comprehension.md` (create)

**Out of scope** (do NOT touch):
- `packages/core/**`. Everything needed is already computed and shipped in `NormalizedTenantPolicy`.
- `TenancyReviewDraft` and the editing forms — **plan 051 owns those**. This plan changes the read-only overview.
- The classification logic in `tenant-policy-loader.ts`. If a table is classified wrongly, that is a core bug to report, not to paper over in the UI.
- Adding a graph-layout library. A nested-list tree is sufficient and adds no dependency; see Step 3.
- Executing SQL against a live database in Step 4. Preview means showing the generated predicate, not running it.

## Git workflow

- Branch: `advisor/052-studio-tenancy-comprehension`
- One commit per step; the four steps are independently shippable.
- Commit style e.g. `feat(studio): show all six tenant coverage classifications`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make coverage complete and reconcilable

Render all six classifications, so the cards sum to the total the header reports.

Read the `dataviz` skill before changing the stat row — this is a KPI tile group and the skill covers grouping, color semantics, and accessible contrast.

Requirements:

- One tile per classification: Root, Scoped, Inherited, Polymorphic, Global, Unknown.
- The six counts must sum to `tenantPolicy.coverage.length`. Add an explicit assertion in the UI — if they do not sum, show a warning rather than silently under-reporting. That is the failure this step exists to prevent, and it would otherwise recur the next time a classification is added.
- `grid-4` no longer fits six tiles; use an existing grid class that does or add one. Check `apps/studio/src/web/styles.css` for what exists before adding.
- Give `Inherited` a distinct meaning in the UI — it is *covered*, reached through a join, not a gap. Only `Unknown` is a gap. The `variant` prop currently encodes this: use `primary` for root/scoped/inherited/polymorphic, `secondary` for global, `warning` for unknown.
- Clarify the header. "N% table coverage" is ambiguous; make it explicit that coverage means "classified", e.g. `42/50 tables classified · 8 unclassified`.

**Verify**: typecheck exits 0. In Studio, open a policy with at least one join-scoped table and confirm the Inherited tile is non-zero and the six tiles sum to the total.

### Step 2: Show which roots each table is scoped through

`TableCoverageEntry.scopeRoots` is computed and never displayed. Add a per-table list beneath the stat tiles — table id, its classification as a badge, and the root labels it is scoped through.

For a schema of any size this needs to be filterable. Add a classification filter (clicking a stat tile is the natural interaction) and a text filter over table names. Default to showing `unknown` tables first — those are the actionable ones.

Resolve root ids to labels via `tenantPolicy.roots`; show the raw id only as secondary text. Users think in terms of "Agency", not `table:public.agencies`.

**Verify**: typecheck exits 0; clicking the Unknown tile filters the list to unclassified tables.

### Step 3: Render the hierarchy as a tree

Replace the flat edge list in `TenancyView` (lines 750-769) with a nested tree.

Build the tree by merging both parentage sources:

- `TenantRoot.parent` — `{ root, foreignKey }` on a root
- `hierarchy` edges — `{ parent, child, foreignKey }`

Requirements:

- Roots with no parent are top-level; children nest beneath them.
- Each node shows the root **label** prominently, the tenant id column as secondary text, and the foreign key linking it to its parent.
- Show a count of tables scoped through each root, derived from the `scopeRoots` data used in Step 2. This is what turns the tree from decoration into a decision aid — it shows where the schema's weight actually sits.
- **Cycles must not hang the renderer.** `detectHierarchyCycles` in the loader only warns; a cyclic policy still loads and reaches this component. Track visited nodes during the walk and render a cycle marker instead of recursing. Verify this with a deliberately cyclic policy.
- Roots that are unreachable from any top-level node (orphans) must still render, in a clearly labelled separate group. Silently dropping them would hide exactly the misconfiguration the user needs to see.

Use a nested list with indentation and CSS connectors — **do not add a graph-layout dependency**. Tenant hierarchies are shallow and a nested list is more accessible than an SVG graph. Invoke `react-doctor` afterwards to check tree roles and keyboard navigation.

**Verify**: typecheck exits 0; a three-level hierarchy renders nested; a deliberately cyclic policy renders without hanging.

### Step 4: Scope preview

Give the user a way to answer "what would this scope let someone see?"

Reuse the playground's existing scope builder — `PlaygroundPage.tsx:397-417` already constructs and validates a `TenantScope` and shows its JSON. Decide where the preview lives: extending the playground's tenant panel is likely lower-effort than a new surface on the tenancy page, since the scope inputs already exist there. Choose based on what you find and record the reasoning.

The preview must show, for a scope the user has entered:

- Which tables that scope reaches, grouped by classification, using the same `scopeRoots` data as Step 2.
- The concrete tenant predicate that would be injected — the placeholder, the resolved ids, and the resulting SQL fragment. `ask()` already returns `tenantBindings` (`TenantBinding` carries `placeholder`, `rootLabel`, `rootId`, `ids`); surface it directly.
- Any tables that would be **inaccessible** under this scope. Equally important and easier to overlook.

Two honesty constraints:

- **If the scope is `subtree`, say what will actually happen.** At `595182d`, subtree scopes are not expanded to descendants (plan 047 fixes this). Until it lands, a preview implying descendant access would be actively misleading. Check whether 047 has landed — `grep -rn "resolveTenantDescendants" packages/core/src` — and if it has not, show an explicit note that subtree expansion is not yet applied.
- **Label the preview as a projection of the policy, not a guarantee.** Plan 045 establishes that AskDB's tenant checks are a lint rather than a boundary. The preview shows what the policy declares; it does not prove the generated SQL will comply. One sentence, near the output.

**Verify**: typecheck exits 0; entering an `ids` scope shows reachable tables and the predicate that would be injected.

### Step 5: Tests, changeset, and gate

Check for component testing: `grep -rln "@testing-library" apps/studio/src`.

- **If present**: test the tree builder (nesting, cycle termination, orphan grouping) and the coverage sum assertion.
- **If absent**: do not introduce a setup. Extract the tree-building and coverage-counting logic into **pure functions** in a separate module and unit-test those with vitest — they are the parts with real logic, and they are testable without a DOM. Note the component-testing gap in your report.

At minimum, pure-function tests for: building a tree from mixed `parent` declarations and `hierarchy` edges; terminating on a cycle; grouping orphans; and counting all six classifications so they sum to the total.

Create `.changeset/studio-tenancy-comprehension.md` — **minor** for `@askdb/studio`.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

Per Step 5. The three cases that matter most, all pure-function testable:

1. **Tree build with a cycle terminates.** The loader only warns about cycles, so the renderer must defend itself.
2. **Coverage counts sum to the total.** The regression guard for the exact bug this plan fixes — a seventh classification added later must not silently vanish.
3. **Orphan roots appear.** Dropping them would hide a real misconfiguration.

## Done criteria

ALL must hold:

- [ ] `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` exits 0
- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `grep -c "CoverageStat label=" apps/studio/src/web/views/tenancy/TenancyPage.tsx` returns `6` (or the equivalent exists in an extracted component)
- [ ] The six coverage counts sum to `tenantPolicy.coverage.length`, asserted in the UI and covered by a unit test
- [ ] The hierarchy renders as a nested tree, verified against a three-level policy
- [ ] A cyclic hierarchy renders without hanging, covered by a unit test
- [ ] Orphan roots render in a labelled group
- [ ] Scope preview shows reachable tables and the injected predicate
- [ ] If plan 047 has not landed, the preview explicitly notes that subtree expansion is not applied
- [ ] `git diff --name-only packages/` is empty (core untouched)
- [ ] No editing-form changes (plan 051's scope) — `TenancyReviewDraft` untouched
- [ ] `.changeset/studio-tenancy-comprehension.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 044 has not landed and the Studio typecheck is still a no-op. Confirm with the probe from that plan before starting.
- The six classification counts do not sum to `coverage.length` even after including all six. That means the loader is producing a classification not in the union, which is a core bug — report it, do not compensate in the UI.
- Building the tree requires resolving an ambiguity you cannot settle — for example a root with both a `parent` declaration and a conflicting `hierarchy` edge. Plan 047 faces the same question; check whether it landed and match its precedence. If neither has settled it, report both options with a recommendation.
- Step 4 turns out to need a new backend endpoint. Reusing the existing ask/scope plumbing is the premise; if it does not hold, report what is missing rather than adding an endpoint.
- You conclude a graph-layout library is necessary for the tree. Report why; the nested-list constraint is deliberate.

## Maintenance notes

- **Adding a seventh `TableTenantClassification` requires a tile here.** The sum assertion from Step 1 is the tripwire that makes the omission visible instead of silent — keep it, and keep its test.
- **The tree must stay defensive about cycles** for as long as `detectHierarchyCycles` only warns. If the loader is ever changed to reject cyclic policies outright, this guard can be simplified — but not before.
- **Scope preview will need updating when plan 047 lands.** The subtree caveat from Step 4 should be replaced with real descendant expansion at that point. Leaving a stale caveat would be its own kind of wrong.
- **This plan and 051 both touch `TenancyPage.tsx`.** 051 owns `TenancyReviewDraft` (editing); this plan owns `TenancyView` (read-only). If both are in flight, coordinate — the file is already 923 lines and both plans add to it. Extracting components is encouraged in both.
- **Reviewer focus**: that the coverage sum assertion exists and is tested, and that the cycle guard is a visited set rather than a depth cap.
