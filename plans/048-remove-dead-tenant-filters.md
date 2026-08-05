# Plan 048: Remove `tenantFilters` — a documented, UI-backed field that nothing reads

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/core/src/schema/v2/tenant-policy.ts apps/studio/src/web/contexts/playground-context.tsx apps/studio/src/web/views/playground/PlaygroundPage.tsx apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 044 (soft) — 044 turns on typechecking for the Studio web UI, which makes removing a field from the shared type safe to verify rather than a manual grep exercise. Landing 044 first is strongly recommended.
- **Category**: tech-debt
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: **Yes, at the type level.** `TenantScope.tenantFilters` is part of the published `@askdb/core` surface. Any caller setting it gets a compile error after this change — but their value was never doing anything, so nothing behavioral breaks. Pre-1.0 beta.

## Why this matters

`tenantFilters` looks like a working feature from every angle a user can see. It is declared on the public `TenantScope` type, validated by zod, has a complete row-editor UI in Studio's playground with add/remove/edit, is serialized into the `tenantScope` JSON preview shown to users, and is documented in the multi-tenancy guide as the way to pre-resolve polymorphic scope.

**No code in `packages/core` ever reads it.** A user can carefully fill in filter conditions, watch them appear in the JSON preview, pass that scope to `ask()`, and get a query with no trace of them. For a feature in a tenancy boundary, a silently-ignored input is worse than a missing one: it invites reliance on protection that is not there.

Removing it is the honest move. Implementing it would mean designing semantics that were never specified — and the polymorphic-scope need it was meant to serve is better addressed by the enforcement work in plans 049 and 050.

## Current state

### The type and its validation — `packages/core/src/schema/v2/tenant-policy.ts`

Lines 136-144:

```ts
export type TenantFilterCondition = {
  column: string;
  operator: "=" | "IN" | "!=" | "NOT IN";
  value: string | string[];
};

export type TenantFilter = {
  conditions: TenantFilterCondition[];
};
```

Line 157, inside `TenantScope`:

```ts
  tenantFilters?: Record<string, TenantFilter>;
```

Lines 202-210 and 223, the zod counterparts:

```ts
const tenantFilterConditionSchema = z.object({
  column: z.string().min(1),
  operator: z.enum(["=", "IN", "!=", "NOT IN"]),
  value: z.union([z.string(), z.array(z.string())]),
});

const tenantFilterSchema = z.object({
  conditions: z.array(tenantFilterConditionSchema).min(1),
});
```
```ts
  tenantFilters: z.record(z.string(), tenantFilterSchema).optional(),
```

### Proof that nothing reads it

```bash
grep -rn "tenantFilters" packages/core/src | grep -v "\.test\."
```

At `595182d` this returns exactly two lines — the type declaration (157) and the zod field (223). No consumer. Run it yourself before starting; if it returns a third line, someone has implemented it and this plan is void.

### The Studio UI that collects it

`apps/studio/src/web/contexts/playground-context.tsx` — filter state and conversion:

- line 96: `filterRows: TenantFilterConditionDraft[];`
- line 130: `filterRows: [],`
- line 482: reducer case setting `filterRows`
- line 498: pruning rows whose table is no longer polymorphic
- line 518: hydrating `filterRows` from an existing `scope.tenantFilters`
- lines 633-635: `buildTenantFilters(filterRows)` and assignment onto the scope
- lines 665-696: the `buildTenantFilters` function itself

`apps/studio/src/web/views/playground/PlaygroundPage.tsx` — the editor:

- line 36: `askTenantFilterRows, setAskTenantFilterRows,` pulled from context
- lines 308-350: the row editor with column/operator/value inputs and add/remove handling

### The documentation

`apps/docs-site/src/content/docs/guides/multi-tenancy.mdx:173`:

```
`tenantFilters` lets the host pre-resolve polymorphic scope.
```

Search the other tenancy docs too — `docs/specs/multi-tenancy.md` and `docs/contracts/tenant-policy.md` — before assuming that is the only mention.

### Conventions

- Studio playground state lives in a reducer in `playground-context.tsx`; removing a field means removing its state slice, its reducer cases, its context exposure, and its consumers in `PlaygroundPage.tsx`. Follow the existing structure rather than restructuring.
- Docs-site MDX is hand-authored and separate from `docs/*.md`; both need editing.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Core typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Studio typecheck | `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` | exit 0 (meaningful only after plan 044) |
| Studio lint | `pnpm --filter @askdb/studio lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test && pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/schema/v2/tenant-policy.ts` — remove the types, the zod schemas, and the field
- `packages/core/src/schema/v2/tenant-policy.test.ts` — remove or update cases that exercise it
- `packages/core/src/index.ts` and `packages/core/src/schema/v2/index.ts` — remove any re-export of the removed types
- `apps/studio/src/web/contexts/playground-context.tsx` — remove the filter state slice
- `apps/studio/src/web/views/playground/PlaygroundPage.tsx` — remove the row editor
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`, `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md` — remove the claims
- `.changeset/remove-tenant-filters.md` (create)

**Out of scope** (do NOT touch):
- `polymorphicTables` in the tenant policy. That is a *policy* concept that is implemented and used by the guardrail and the prompt. `tenantFilters` was a *runtime scope* concept. They are easy to confuse; only the latter goes.
- Any other field on `TenantScope` — `access` and `context` stay.
- Implementing polymorphic scope resolution. If that capability is wanted, it should be designed against the enforcement model in plan 050, not retrofitted here.
- Restructuring the playground reducer beyond removing this slice.

## Git workflow

- Branch: `advisor/048-remove-dead-tenant-filters`
- Commit style e.g. `refactor(core)!: remove unimplemented tenantFilters from TenantScope`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the field is genuinely dead

```bash
grep -rn "tenantFilters\|TenantFilter" packages --include=*.ts | grep -v "\.test\." | grep -v "/dist/"
```

Every result must be either the declaration site in `packages/core/src/schema/v2/tenant-policy.ts` or a re-export. **If any line reads the value** — passes it to a function, branches on it, interpolates it into SQL — STOP. The premise of this plan is wrong and it must be re-scoped.

**Verify**: you have inspected each result and confirmed none is a read.

### Step 2: Remove from `@askdb/core`

Delete from `packages/core/src/schema/v2/tenant-policy.ts`:

- `TenantFilterCondition` (lines 136-140)
- `TenantFilter` (lines 142-144)
- the `tenantFilters` field on `TenantScope` (line 157)
- `tenantFilterConditionSchema` (lines 202-206)
- `tenantFilterSchema` (lines 208-210)
- the `tenantFilters` entry in `tenantScopeSchema` (line 223)

Then remove any re-export of the deleted type names from `packages/core/src/index.ts` and `packages/core/src/schema/v2/index.ts`. Find them with `grep -n "TenantFilter" packages/core/src/index.ts packages/core/src/schema/v2/index.ts`.

Note the zod object: `tenantScopeSchema` is a `z.object`, not `z.strictObject`, so a caller passing `tenantFilters` after this change will have it silently ignored at validation rather than rejected. That is the right lenient behavior for a removed optional field — do not tighten it to `strictObject` here, which would turn a no-op into a runtime throw for existing callers.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0; `grep -rn "tenantFilters" packages/core/src` → no matches outside tests.

### Step 3: Update core tests

Remove or update cases in `packages/core/src/schema/v2/tenant-policy.test.ts` that construct a scope with `tenantFilters`. Find them with `grep -n "tenantFilters" packages/core/src/schema/v2/tenant-policy.test.ts`.

Where a test's *purpose* was validating the filter shape, delete the test — the shape no longer exists. Where a test merely happened to include the field alongside what it was really asserting, strip the field and keep the test.

Add one new case asserting that a scope object carrying a stray `tenantFilters` key still validates successfully — pinning the lenient behavior from Step 2 so nobody accidentally makes it throw later.

**Verify**: `pnpm --filter @askdb/core test` → all pass.

### Step 4: Remove the Studio playground filter UI

In `apps/studio/src/web/contexts/playground-context.tsx`, remove: the `filterRows` state field (line 96) and its initial value (line 130); the reducer cases at lines 482 and 498; the hydration at line 518; the `buildTenantFilters` call and assignment at lines 633-635; the `buildTenantFilters` function (lines 665-696); the `TenantFilterConditionDraft` type if it becomes unused; and the `askTenantFilterRows` / `setAskTenantFilterRows` context exposure around line 372.

In `apps/studio/src/web/views/playground/PlaygroundPage.tsx`, remove the destructured `askTenantFilterRows, setAskTenantFilterRows` (line 36) and the row editor block (lines 308-350). Remove the surrounding section wrapper and its heading if that block was its only content — check the JSX structure rather than assuming.

Do not restructure anything else in either file.

**Verify**: `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` → exit 0, and `pnpm --filter @askdb/studio lint` → exit 0. (If plan 044 has not landed, the typecheck is a no-op — say so in your report and rely on `grep` instead.)

### Step 5: Remove the documentation claims

Delete the sentence at `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx:173` and any surrounding example that uses `tenantFilters`. Check `docs/specs/multi-tenancy.md` and `docs/contracts/tenant-policy.md` for the same claim:

```bash
grep -rn "tenantFilters" docs apps/docs-site/src
```

If the guide had a section on polymorphic scope built around this field, do not leave a hole — replace it with a short, accurate paragraph saying polymorphic tables are declared in the policy and surfaced to the model via the prompt, and that runtime pre-resolution is not currently supported.

**Verify**: `grep -rn "tenantFilters" docs apps/docs-site/src` → no matches; `pnpm docs:build` → exit 0.

### Step 6: Changeset and full gate

Create `.changeset/remove-tenant-filters.md` — **minor** for `@askdb/core` and **patch** for `@askdb/studio`.

The body must be direct: `TenantScope.tenantFilters` has been removed because no code ever read it. Callers setting it were getting no effect; removing it turns a silent no-op into a compile error. Note that the runtime validator remains lenient, so a stray key does not throw. Mention that polymorphic tables in the *policy* are unaffected.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- Update `packages/core/src/schema/v2/tenant-policy.test.ts` per Step 3, including the new lenient-validation case.
- No new Studio tests — this is a deletion. The typecheck from plan 044 is the guard that every reference was removed; if 044 has not landed, `grep` is the substitute and you must say so explicitly in your report.
- Verification: `pnpm test` → all pass, with a *lower* total count than before (tests were removed) — note the delta in your report so a reviewer can confirm the drop was intentional.

## Done criteria

ALL must hold:

- [ ] `grep -rn "tenantFilters\|TenantFilter" packages/core/src apps/studio/src docs apps/docs-site/src` returns no matches
- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` exits 0
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build` all exit 0
- [ ] A test asserts a scope with a stray `tenantFilters` key still validates
- [ ] `grep -n "polymorphicTables" packages/core/src/schema/v2/tenant-policy.ts` still returns matches (the policy concept survives)
- [ ] `.changeset/remove-tenant-filters.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 finds any code that actually reads `tenantFilters`. The plan's premise fails.
- Removing the field breaks a test whose purpose is clearly something other than filter validation — that would suggest a hidden dependency worth understanding before deleting.
- The Studio filter UI turns out to be wired to something beyond `tenantFilters` — for example if `filterRows` also feeds a display or export path. Report what else consumes it.
- You conclude the feature should be implemented rather than removed. That is a legitimate position, but it needs a specification that does not currently exist. Report the argument and stop; do not start implementing semantics.

## Maintenance notes

- **If polymorphic scope pre-resolution is wanted later, design it against the enforcement model, not as a scope field.** The original idea — the host hands AskDB pre-resolved conditions — assumes AskDB will faithfully apply them to generated SQL, which is exactly the prompt-and-hope pattern that plans 045 and 050 are moving away from. A host that can pre-resolve conditions can equally apply them itself, or express them as a database row-level-security policy.
- **This deletion is a useful precedent.** The same audit — "is this declared field ever read?" — is worth running across `TenantScope` and `NormalizedTenantPolicy` generally. `TenantScopeContext` is explicitly advisory and *is* used by the prompt builder, so it is fine; but the exercise is cheap and this field proves it finds real things.
- **Reviewer focus**: confirm `polymorphicTables` (the policy concept) was not removed along with `tenantFilters` (the scope concept), and that the test count decrease matches the number of deleted tests.
