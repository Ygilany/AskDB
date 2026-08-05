# Plan 051: Let Studio actually author a tenant policy — add and edit, not just delete

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- apps/studio/src/web/views/tenancy` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — a large amount of new form UI in a single file. The risk is scope creep and an unreviewable diff, not correctness; the steps are ordered so each entity type is independently shippable.
- **Depends on**: plan 044 (**hard**). 044 turns on typechecking for the Studio web UI. Writing several hundred lines of new form code against an unchecked compiler is not acceptable — every prop mismatch would be found at runtime by a user.
- **Category**: dx
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No — additive UI. The saved policy file format is unchanged.

## Why this matters

Studio is where AskDB expects users to author their tenant policy. For anything beyond the simplest tenancy, it cannot.

The manual path collects exactly one root table, one tenant ID column, and one label. No hierarchy, no scoped tables, no join paths. The review screen — which is also the edit screen for an already-saved policy — renders hierarchy edges, scoped tables, and polymorphic tables as cards with a **delete button and nothing else**. There is no way to add one, and no way to correct one.

So a user with a real multi-tenant schema has two options: accept whatever "Draft with AI" produces, or leave Studio and hand-edit markdown front matter. If the AI draft gets a join path wrong — the single most error-prone part of a tenant policy — the only in-product action available is to delete it.

Every one of these entities already has a defined shape, is already validated, and is already rendered. The gap is purely the ability to create and modify them.

## Current state

All references are `apps/studio/src/web/views/tenancy/TenancyPage.tsx` at commit `595182d`, a 923-line file.

### The two entry points share one component

`TenancyEditSavedPolicy` (line 271) wraps `TenancyReviewDraft` and is used to edit an existing saved policy:

```tsx
function TenancyEditSavedPolicy({
  tenantPolicy,
  tables,
  busy,
  saveStatus,
  onSave,
  onCancel,
}: { /* … */ }) {
  const [frontmatter, setFrontmatter] = useState<TenantPolicyFrontmatter>(() => frontmatterFromTenantPolicy(tenantPolicy));
  const [body, setBody] = useState(() => tenantPolicy.body);

  return (
    <TenancyReviewDraft
      tables={tables}
      frontmatter={frontmatter}
      /* … */
      onFrontmatterChange={setFrontmatter}
```

`TenancyReviewDraft` (line 616) is also the review step for a new draft. **Anything added to it benefits both paths**, which is why this plan targets it rather than the create form.

### Everything `TenancyReviewDraft` can currently mutate

Lines 645-671:

```tsx
  function updateEnforcement(e: "strict" | "warn") { /* … */ }
  function updateRootLabel(index: number, label: string) { /* … */ }
  function removeRoot(index: number) { /* … */ }
  function removeHierarchyEdge(index: number) { /* … */ }
  function removeScopedTable(index: number) { /* … */ }
  function removePolymorphicTable(index: number) { /* … */ }
  function toggleGlobalTable(tableId: string) { /* … */ }
```

Five removals, one label edit, one enforcement toggle, one global-table checkbox. No `add*`, and no edit for anything structural.

The sections are conditionally rendered only when non-empty — line 750, line 771, line 799:

```tsx
          {(frontmatter.hierarchy ?? []).length > 0 && (
```
```tsx
          {(frontmatter.scopedTables ?? []).length > 0 && (
```
```tsx
          {(frontmatter.polymorphicTables ?? []).length > 0 && (
```

So an empty section is invisible, which is also why there is nowhere to put an "Add" button today.

### The single-root manual form — lines 509-548

```tsx
            <section className="card">
              <div className="card-hd"><h3>Tenant Root</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 16 }}>
                  <Field label="Root table" description="The table whose rows represent tenants.">
```

Its state is a flat reducer over three scalars — `CreateFormState` at line 333:

```ts
type CreateFormState = {
  mode: "choose" | "manual" | "review";
  draftStatus: StatusMessage | null;
  draftFrontmatter: TenantPolicyFrontmatter | null;
  draftBody: string;
  enforcement: "strict" | "warn";
  rootTableId: string;
  rootTenantIdColumn: string;
  rootLabel: string;
  globalTableIds: string[];
};
```

### The shapes the forms must produce — `packages/core/src/schema/v2/tenant-policy.ts:7-52`

```ts
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
```ts
export const scopedTableSchema = z.strictObject({
  id: z.string().min(1),
  scopeThrough: z.array(scopeThroughSchema).min(1),
});

export const polymorphicTableSchema = z.strictObject({
  id: z.string().min(1),
  typeColumn: z.string().min(1),
  idColumn: z.string().min(1),
  mapping: z.record(z.string(), z.string().min(1)),
});
```

where `scopeThrough` is a union of `{ root, column }` and `{ root, join: [{ from, to }, …] }`.

Note every schema is `z.strictObject` — an extra key is a validation failure, so forms must produce exactly these shapes.

### Identifier formats

Table ids look like `table:public.orders`; column ids like `table:public.orders#agency_id`. The existing renderers assume this (`tenant-guardrail.ts` splits on `.` and `#`). Any picker must emit ids in the same format. `StudioTableDto` supplies `t.physical.id`, `t.physical.schema`, `t.physical.name`, and a `columns` array with `id`, `name`, `type`, `primaryKey` — see how the manual form's selects use them at lines 514-541.

### Save path

`apps/studio/src/web/api.ts:49` posts to `/api/tenant-policy`. `onSave(frontmatter, body?)` is already threaded through both entry points; this plan does not touch the save path at all.

### Conventions

- Existing form controls in this file: `<Field label description>` wrapping a `<select>` or `<Input>`; `Badge` for chips; `section.card` / `card-hd` / `card-bd` for panels. Reuse them; do not introduce a new form abstraction.
- Buttons use `className="btn"`, `"btn ghost sm"` for inline actions.
- Styling is inline `style={{}}` objects alongside class names. Match it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Studio typecheck | `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` | exit 0 |
| Studio lint | `pnpm --filter @askdb/studio lint` | exit 0 |
| Studio build | `pnpm --filter @askdb/studio build` | exit 0 |
| Studio tests | `pnpm --filter @askdb/studio test` | all pass |
| Run Studio | `pnpm --filter @askdb/studio dev` then open the printed URL | Studio loads |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |

For manual verification you need a schema with a tenant-shaped structure. Check `fixtures/schemas/` for a suitable artifact; if none has a self-referencing table, say so in your report and verify with the closest available.

## Suggested executor toolkit

- A `react-doctor` skill is available for files under `apps/studio/`. Invoke it after Step 4 to check the new components for accessibility and lint issues before you finish.

## Scope

**In scope**:
- `apps/studio/src/web/views/tenancy/TenancyPage.tsx`
- New component files under `apps/studio/src/web/views/tenancy/` if the page exceeds roughly 1,200 lines — extracting the new editors is preferable to one enormous file
- `apps/studio/src/web/styles.css` — only if a new pattern genuinely needs a class; prefer reusing existing ones
- `.changeset/studio-tenant-policy-authoring.md` (create)

**Out of scope** (do NOT touch):
- `packages/core/**`. The policy schema is fixed; this plan builds UI that produces the existing shapes.
- The save API (`/api/tenant-policy`) and `apps/studio/src/web/api.ts`.
- The AI drafting path (`handleDraftWithAi`, line 405) — it already produces complete front matter; this plan makes its output editable.
- Coverage stats, the hierarchy tree view, and scope preview — **plan 052 owns those**. Resist doing them here; this plan is already L.
- The `TenancyView` read-only overview (line 93). Editing happens in `TenancyReviewDraft`.
- Any change to the on-disk `tenant-policy.md` format.

## Git workflow

- Branch: `advisor/051-studio-tenant-policy-authoring`
- **One commit per entity type.** Steps 2–5 are independently shippable and a reviewer needs them apart.
- Commit style e.g. `feat(studio): add and edit hierarchy edges in the tenant policy editor`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the entity sections always visible, with an add affordance

Change the three conditional renders (lines 750, 771, 799) so each section renders whether or not it has entries. When empty, show a one-line explanation of what the entity is for and an "Add" button; when non-empty, show the existing cards plus the same button.

The empty-state copy matters — it is the only in-product explanation of these concepts:

- **Hierarchy edges** — "Declares that one tenant root's rows belong to another — for example counties belonging to a state. Required for subtree access."
- **Scoped tables** — "Tables whose rows belong to a tenant. Each needs a path to a tenant root, either a direct column or a join."
- **Polymorphic tables** — "Tables that reference different entity types through a type column and an id column."

Add nothing else in this step. The buttons can be present and disabled, or wired to a no-op you replace in the next steps — but the page must still build and render.

**Verify**: `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` → exit 0; run Studio and confirm all three sections appear for a policy that has none of them.

### Step 2: Add and edit hierarchy edges

An edge is `{ parent, child, foreignKey }` where `parent` and `child` are tenant **root ids** already present in `frontmatter.roots`, and `foreignKey` is a column id on the child's table.

Build an editor with three pickers: parent root (select over `frontmatter.roots`), child root (same, excluding the chosen parent), and foreign key (select over the child root's table columns, emitting `table:schema.name#column` format).

Add `addHierarchyEdge(edge)` and `updateHierarchyEdge(index, edge)` beside the existing `removeHierarchyEdge`, following its immutable-update style exactly:

```tsx
  function removeHierarchyEdge(index: number) {
    const h = (frontmatter.hierarchy ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, hierarchy: h.length > 0 ? h : undefined });
  }
```

Note the `h.length > 0 ? h : undefined` pattern — the field is omitted rather than left as an empty array. Preserve that.

Validate in the form, before it can be saved: parent and child must differ, and the same parent/child pair must not already exist. Do **not** attempt cycle detection here — the loader already does it (`detectHierarchyCycles` in `packages/core/src/schema/v2/tenant-policy-loader.ts`) and surfaces a warning; duplicating that logic in the UI creates two sources of truth.

**Verify**: typecheck exits 0; in Studio, add an edge to a policy with two roots, save, reload the page, and confirm it persisted.

### Step 3: Add and edit scoped tables — including join paths

The most valuable step in this plan, and the most involved. A scoped table is `{ id, scopeThrough: [...] }` where each entry is either:

- `{ root, column }` — the table has a direct tenant column
- `{ root, join: [{ from, to }, …] }` — the table is reached by joining through other tables

Build an editor with: a table picker (over `tables`, excluding ones already classified as root/scoped/polymorphic/global — the existing global-tables checkbox at line 832 already computes those exclusion sets, reuse the approach); then a repeatable list of scope paths, each with a root picker and a mode toggle between "direct column" and "join path".

For **direct column**, one select over the chosen table's columns.

For **join path**, a repeatable ordered list of `{ from, to }` column pairs with add/remove/reorder. This is where AI drafts most often go wrong and where the ability to correct matters most. Render the path as a readable chain — `orders.customer_id → customers.id → customers.agency_id` — beneath the editor so the user can see what they built. The existing renderer at line 786 already formats this; reuse its formatting logic.

A scoped table must have at least one scope path (`z.array(...).min(1)`); prevent saving with zero.

Add `addScopedTable`, `updateScopedTable`, and keep `removeScopedTable`.

**If the join-path editor alone exceeds roughly 200 lines, extract it to its own component file** in the same directory.

**Verify**: typecheck exits 0; in Studio, add a scoped table with a two-step join path, save, reload, and confirm the path round-trips exactly.

### Step 4: Add and edit polymorphic tables, and roots

**Polymorphic tables** — `{ id, typeColumn, idColumn, mapping }`. Table picker, two column pickers, and a key/value editor for `mapping` where the key is a free-text type value (as stored in the data) and the value is a select over root ids. Add/remove rows.

**Roots** — the review screen can currently only rename a root (`updateRootLabel`, line 648) and remove one. Add `addRoot`, and allow editing `tenantIdColumn` and the optional `parent` (`{ root, foreignKey }`) on an existing root. The manual create form's single-root flow (lines 509-548) stays as it is — it is a reasonable starting point, and once the review screen can add roots the single-root limitation is no longer a dead end. Say so in your report.

**Verify**: typecheck exits 0; in Studio, add a second root, give it a parent, save, reload, and confirm both roots and the parent linkage persisted.

### Step 5: Surface loader warnings in the editor

`NormalizedTenantPolicy.warnings` carries `TenantPolicyWarning[]` — orphaned ids, unknown roots in scope paths, hierarchy cycles (see the union at `packages/core/src/schema/v2/tenant-policy.ts:245-255`). These are exactly the mistakes the new editors make possible, and they are currently computed and then not shown on the edit screen.

Render them as a warning panel at the top of `TenancyReviewDraft` when present, each with the entity id it refers to.

Warnings come from the *loaded* policy, so they reflect the last saved state, not unsaved edits. Label the panel accordingly — "Warnings from the last saved policy" — rather than implying live validation. Do not attempt live re-validation in the browser; that would mean reimplementing the loader.

**Verify**: typecheck exits 0; save a policy with a scope path referencing a non-existent root, reload, and confirm the warning appears.

### Step 6: Tests, changeset, and full gate

Check whether Studio has React component testing: `grep -rln "@testing-library" apps/studio/src`.

- **If it does**: add tests for each new editor covering add, edit, and remove, plus the two validation rules from Step 2 (parent ≠ child, no duplicate pair) and the minimum-one-scope-path rule from Step 3.
- **If it does not**: do **not** introduce a component-testing setup — that is its own decision. Instead, write a manual verification checklist into your report covering every add/edit/remove path, and note the testing gap explicitly.

Either way, add a pure unit test for any non-trivial helper you extracted — for instance a function converting a column picker's selection into a `table:schema.name#column` id. Pure helpers are testable regardless of the component setup.

Create `.changeset/studio-tenant-policy-authoring.md` — **minor** for `@askdb/studio`. Body: the tenant policy editor now supports adding and editing hierarchy edges, scoped tables (including multi-step join paths), polymorphic tables, and roots, where previously these could only be deleted or produced by AI drafting; loader warnings are now surfaced in the editor.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

Covered in Step 6, which branches on whether component testing exists.

The highest-value coverage regardless of setup: **the round-trip.** For each entity type, build it in the UI, save, reload, and confirm the persisted front matter matches what was entered. Every schema here is `z.strictObject`, so a form emitting one extra key produces a save failure — round-trip verification catches that class immediately.

## Done criteria

ALL must hold:

- [ ] `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` exits 0
- [ ] `pnpm --filter @askdb/studio lint` exits 0
- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `grep -c "function addHierarchyEdge\|function addScopedTable\|function addPolymorphicTable\|function addRoot" apps/studio/src/web/views/tenancy/TenancyPage.tsx` returns `4` (or the equivalent exists in extracted component files)
- [ ] All three entity sections render when empty, each with an add affordance
- [ ] A scoped table with a two-step join path was created in the UI, saved, reloaded, and verified to round-trip — stated in your report
- [ ] Loader warnings render in the editor when present
- [ ] `git diff --name-only packages/` is empty (core untouched)
- [ ] No coverage-stat, tree-view, or scope-preview work was done (plan 052's scope)
- [ ] `.changeset/studio-tenant-policy-authoring.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 044 has not landed and `tsc -p tsconfig.web.json --noEmit` still exits 0 with a deliberately broken file. Writing this much new UI without a working typechecker is not acceptable — land 044 first.
- A form cannot produce a shape that passes the `z.strictObject` schemas without adding a field to `packages/core`. Report the specific shape; do not modify core.
- `TenancyPage.tsx` exceeds roughly 1,200 lines and extraction would require restructuring how `TenancyReviewDraft` receives state. Report the structure you would use before doing it.
- You find yourself needing live policy re-validation in the browser to make an editor usable. That means reimplementing the loader client-side; report it instead.
- The column-id format assumption (`table:schema.name#column`) turns out to be wrong for some engine. Verify against a real schema artifact in `fixtures/schemas/` early — before Step 2, not after Step 4.

## Maintenance notes

- **`TenancyReviewDraft` is shared by the create-review and edit-saved paths.** Every addition benefits both, and every regression breaks both. Keep it that way; do not fork the component.
- **The single-root manual create form is now a starting point rather than a ceiling**, because the review screen can add roots. If the create form is ever extended, the right move is probably to delete its bespoke fields and drop the user straight into the review editor with an empty policy.
- **Validation lives in two places by design**: light, immediate rules in the form (parent ≠ child, no duplicate pair, at least one scope path) and authoritative rules in the loader (cycles, orphaned ids, unknown roots). Do not migrate loader rules into the UI — surface their warnings instead, as Step 5 does.
- **Plan 052 builds on this**: coverage stats, hierarchy tree view, and scope preview. It should land after, since it renders the entities this plan makes creatable.
- **Reviewer focus**: the join-path editor. It is the most complex new UI and the most consequential to get wrong, since a bad join path silently scopes a table to the wrong tenant. Check that the round-trip test was actually performed rather than assumed.
