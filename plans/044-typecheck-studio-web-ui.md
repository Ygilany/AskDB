# Plan 044: Typecheck the Studio web UI, and fix the crash it has been hiding

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- tsconfig.base.json apps/studio/tsconfig.web.json apps/studio/src/web` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — turning on a typechecker that has never run will surface unknown errors. Step 2 measures the blast radius before you commit to fixing anything.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No — build output and runtime behavior are unchanged. Only CI strictness changes.

## Why this matters

The entire Studio browser UI — every file under `apps/studio/src/web/`, roughly 5,400 lines including the 923-line tenancy policy editor — is **not typechecked by anything**. The `lint` script appears to check it and does not. Vite builds it with esbuild, which strips types without checking them.

This is not theoretical. It has already shipped a crash: `apps/studio/src/web/views/tenancy/TenancyPage.tsx:763` calls `removeHierarchyEdge(i)` where `i` does not exist in scope. A user who clicks the × button on a hierarchy edge in the tenant policy editor gets `ReferenceError: i is not defined` and the click does nothing. TypeScript would have caught this as `TS2304: Cannot find name 'i'` on the day it was written.

Fixing the typechecker and fixing the bug must land together: the moment the typechecker runs, that line becomes a compile error, so a tsconfig-only change would break CI.

## Current state

### Why the typechecker silently does nothing

`tsconfig.base.json` (the file every package extends) ends with:

```json
  "exclude": ["node_modules", "dist", "apps/studio/src/web/**"]
```

`apps/studio/tsconfig.web.json` sets an `include` covering the web sources but **never overrides `exclude`**:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] },
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["vite/client", "react", "react-dom"]
  },
  "include": ["src/shared/**/*.ts", "src/web/**/*.ts", "src/web/**/*.tsx", "vite.config.ts"]
}
```

In TypeScript, `exclude` filters the set produced by `include`, and an inherited `exclude` applies unless the child config declares its own. The inherited `apps/studio/src/web/**` pattern resolves relative to the base config's directory (the repo root), so it matches exactly this directory and removes every web file from the program.

`apps/studio/package.json` declares:

```json
    "lint": "tsc -p tsconfig.build.json --noEmit && tsc -p tsconfig.web.json --noEmit && eslint .",
```

The second command runs and exits 0 having checked only `src/shared/**` and `vite.config.ts`.

**Confirm this yourself before changing anything** (this is the reproduction, and you will re-run it inverted in Step 3):

```bash
printf 'export const y: string = 42;\n' > apps/studio/src/web/__probe.ts
(cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit; echo "EXIT=$?")
rm -f apps/studio/src/web/__probe.ts
```

Today this prints `EXIT=0` despite an obvious type error. If it prints a non-zero exit and reports `__probe.ts`, the configuration has already been fixed — treat that as a STOP condition.

### The bug this has been hiding

`apps/studio/src/web/views/tenancy/TenancyPage.tsx:750-769`:

```tsx
          {(frontmatter.hierarchy ?? []).length > 0 && (
            <section className="card">
              <div className="card-hd"><h3>Hierarchy Edges ({frontmatter.hierarchy!.length})</h3></div>
              <div className="card-bd">
                <div style={{ display: "grid", gap: 8 }}>
                  {frontmatter.hierarchy!.map((edge) => (
                    <div key={`${edge.parent}-${edge.child}`} className="policy-edge-card">
                      <div>
                        <code>{edge.parent}</code>
                        <span className="muted" style={{ margin: "0 8px" }}>&rarr;</span>
                        <code>{edge.child}</code>
                        <div className="muted tiny" style={{ marginTop: 4 }}>FK: {edge.foreignKey}</div>
                      </div>
                      <button type="button" className="btn ghost sm" onClick={() => removeHierarchyEdge(i)} title="Remove">×</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
```

The `.map((edge) => …)` callback at line 755 takes no index parameter, so `i` at line 763 is a free variable. The only `i` bindings in the file are at lines 725, 776, and 804, all inside sibling `.map()` closures that have already returned.

The sibling sections show the correct pattern. `apps/studio/src/web/views/tenancy/TenancyPage.tsx:776` and its remove button:

```tsx
                  {frontmatter.scopedTables!.map((scoped, i) => (
```
```tsx
                      <button type="button" className="btn ghost sm" onClick={() => removeScopedTable(i)} title="Remove">×</button>
```

The handler being called is already correct and index-based — `TenancyPage.tsx:658-661`:

```tsx
  function removeHierarchyEdge(index: number) {
    const h = (frontmatter.hierarchy ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, hierarchy: h.length > 0 ? h : undefined });
  }
```

So the fix is one line: give the `.map()` an index parameter, matching the sibling sections.

### Repo conventions

- Studio web code is React function components with inline `style` objects alongside utility class names. Match the surrounding file; do not reformat or restyle anything you touch.
- There is a Studio-scoped skill for React diagnostics — see the "Suggested executor toolkit" section.
- Changesets live in `.changeset/*.md`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Studio web typecheck | `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` | exit 0 (after this plan) |
| Studio full lint | `pnpm --filter @askdb/studio lint` | exit 0 |
| Studio build | `pnpm --filter @askdb/studio build` | exit 0 |
| Repo lint | `pnpm lint` | exit 0 |
| Repo build | `pnpm build` | exit 0 |
| Repo tests | `pnpm test` | all pass |

Note: `pnpm exec tsc` inside `apps/studio` requires workspace dependencies to have been built at least once (`pnpm build`), otherwise you will see spurious `TS2307: Cannot find module '@askdb/core'` errors that have nothing to do with this plan.

## Suggested executor toolkit

- A `react-doctor` skill is available when working under `apps/studio/`. If Step 2 surfaces a large number of errors, invoke it to triage them by category before fixing.
- `apps/studio/doctor.config.json` exists and may define project-specific diagnostic settings worth reading first.

## Scope

**In scope**:
- `apps/studio/tsconfig.web.json` — add an `exclude` override
- `apps/studio/src/web/views/tenancy/TenancyPage.tsx` — the one-line index fix
- Any other file under `apps/studio/src/web/` that Step 2 proves must change to make the typecheck pass — but see the STOP conditions for the limit
- `.changeset/typecheck-studio-web.md` (create)

**Out of scope** (do NOT touch):
- `tsconfig.base.json`. It is extended by every package in the monorepo; removing the `apps/studio/src/web/**` entry there would change the program for unrelated configs. Override locally in the child config instead.
- Any behavior change, refactor, restyle, or "while I'm here" cleanup in Studio web files. This plan makes the typechecker run and fixes what it finds. Nothing else.
- `apps/studio/tsconfig.json` and `apps/studio/tsconfig.build.json` — these cover the *server* side, which is already checked and already excludes `src/web/**` deliberately.
- Turning on additional strictness flags. Inherit exactly what `tsconfig.base.json` already sets.

## Git workflow

- Branch: `advisor/044-typecheck-studio-web-ui`
- Commit style follows recent history, e.g. `fix(studio): typecheck the web UI and fix hierarchy edge removal`. Recent examples from `git log --oneline`: `feat(core): add shared SQL parameter binder`, `fix(core): make SQL literal escaping dialect-aware`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make `tsconfig.web.json` actually include the web sources

Add an `exclude` key to `apps/studio/tsconfig.web.json` that overrides the inherited one. Keep the node_modules/dist entries — you are only dropping the `apps/studio/src/web/**` pattern — and add the test-file exclusions consistent with how the rest of the repo builds:

```json
  "exclude": ["node_modules", "dist"],
```

Add a short comment above it in the file explaining why the override exists, so nobody deletes it later:

```jsonc
  // Overrides tsconfig.base.json's "apps/studio/src/web/**" exclusion. An
  // inherited `exclude` filters this config's `include`, so without this key
  // the web UI is silently removed from the program and never typechecked.
```

(JSON with comments is valid in tsconfig files; confirm the repo's other tsconfigs tolerate it, and if any tooling rejects it, drop the comment and note it in your report.)

**Verify**: `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit --listFiles | grep -c "src/web/"` → a number greater than 20 (the web files are now in the program).

### Step 2: Measure the blast radius before fixing anything

Run the typecheck and capture the full error list:

```bash
cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit 2>&1 | tee /tmp/studio-web-errors.txt; wc -l /tmp/studio-web-errors.txt
```

Read the output and classify it before touching code. The expected outcome is a small number of errors — the `i` bug in Step 3 plus possibly a handful of unused-variable or implicit-any issues.

**If the count exceeds 30 errors, STOP and report** with the categorized list. A large number means this needs to be staged (for example by temporarily relaxing a flag for the web config only), which is a decision for the maintainer, not an improvisation for you.

**Verify**: you have a written classification of every error, by file and TS error code.

### Step 3: Fix the hierarchy-edge removal bug

In `apps/studio/src/web/views/tenancy/TenancyPage.tsx`, change line 755 from:

```tsx
                  {frontmatter.hierarchy!.map((edge) => (
```

to:

```tsx
                  {frontmatter.hierarchy!.map((edge, i) => (
```

Change nothing else in that block. Line 763's `removeHierarchyEdge(i)` then resolves to the map index, matching how `removeScopedTable(i)` and `removePolymorphicTable(i)` already work in the sibling sections at lines 776 and 804.

**Verify**:
```bash
cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit 2>&1 | grep -c "TenancyPage"
```
→ `0`.

### Step 4: Fix any remaining errors from Step 2

Work through the classified list. Every fix must be the **minimal type-level correction** — add a missing type annotation, remove a genuinely unused variable, narrow a value that is actually narrow. Do not change runtime behavior to satisfy the compiler, and do not add `any`, `as unknown as`, or `@ts-expect-error` to silence an error. If an error can only be resolved by one of those, it is a real defect: stop and report it rather than suppressing it.

**Verify**: `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` → exit 0.

### Step 5: Prove the typechecker is now real

Re-run the probe from "Current state", inverted. This is the regression test for the configuration itself:

```bash
printf 'export const y: string = 42;\n' > apps/studio/src/web/__probe.ts
(cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit; echo "EXIT=$?")
rm -f apps/studio/src/web/__probe.ts
```

**Verify**: the output reports an error in `src/web/__probe.ts` and prints a non-zero `EXIT`. Confirm the probe file is deleted afterwards (`git status` must be clean of it).

### Step 6: Confirm the full pipeline and write the changeset

Create `.changeset/typecheck-studio-web.md` — **patch** bump for `@askdb/studio`. The body should state that the Studio web UI is now covered by `tsc`, that an inherited `exclude` in `tsconfig.base.json` had been silently removing it from the program, and that this surfaced and fixed a `ReferenceError` when removing a hierarchy edge in the tenant policy editor.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- **The configuration itself is the main thing to protect**, and Step 5's probe is a manual version of that test. Add a permanent guard: a small test in the Studio test suite (find the existing files with `ls apps/studio/src/**/*.test.ts`) that reads `apps/studio/tsconfig.web.json` and asserts its `exclude` array does not contain any entry matching `src/web`. That is a cheap, fast assertion that prevents silent regression if someone later "tidies" the config.
- **For the `i` bug**, add a component test only if the Studio web suite already has React component tests — check with `grep -rln "@testing-library" apps/studio/src`. If it does, add one that renders the hierarchy-edge list with two edges, clicks the second remove button, and asserts the correct edge was removed (the bug would have removed the wrong one, or thrown). If there is no component-testing setup, do **not** introduce one; note the gap in your report instead. Step 3's typecheck is the regression guard in that case.
- Verification: `pnpm --filter @askdb/studio test` → all pass.

## Done criteria

ALL must hold:

- [ ] `cd apps/studio && pnpm exec tsc -p tsconfig.web.json --noEmit` exits 0
- [ ] The Step 5 probe produces a **non-zero** exit and names `__probe.ts`, and the probe file is deleted afterwards
- [ ] `grep -n "hierarchy!.map((edge, i)" apps/studio/src/web/views/tenancy/TenancyPage.tsx` returns a match
- [ ] `git diff --name-only tsconfig.base.json` is empty (the shared config was not touched)
- [ ] `grep -rn "@ts-expect-error\|@ts-ignore" apps/studio/src/web` returns no new matches versus `595182d`
- [ ] `pnpm build`, `pnpm lint`, `pnpm test` all exit 0
- [ ] `.changeset/typecheck-studio-web.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The reproduction in "Current state" does not reproduce — i.e. the probe already fails today. The config has been fixed since this plan was written.
- Step 2 surfaces more than 30 type errors. Report the categorized list and let the maintainer decide how to stage it.
- Any error can only be silenced with `any`, a type assertion, or a `@ts-expect-error`. That is a real defect and needs a decision.
- Fixing a type error would require changing runtime behavior — for example, a value that is genuinely `undefined` at runtime but typed as required. Report the specific case; a behavior change is out of scope here.
- Adding `exclude` to `tsconfig.web.json` does not bring the web files into the program (Step 1's `--listFiles` count stays at 0). Something else is filtering them; investigate and report rather than guessing.

## Maintenance notes

- **The `exclude` override in `tsconfig.web.json` is load-bearing and looks redundant.** It duplicates two entries from the base config. Anyone "cleaning up" by deleting it silently turns off typechecking for the whole Studio UI again. The comment added in Step 1 and the config test added in the test plan are both there to prevent that; keep them.
- **Consider removing `apps/studio/src/web/**` from `tsconfig.base.json` entirely** in a follow-up. It exists so the *server* build does not try to compile JSX, but the server configs (`tsconfig.json`, `tsconfig.build.json`) already exclude `src/web/**` themselves, so the base entry may be pure legacy. Verify before removing — deliberately deferred here because it affects every package in the monorepo.
- **Reviewer focus**: confirm no `any` or suppression comments were added, that `tsconfig.base.json` is untouched, and that the Step 5 probe was actually run (it is the only thing proving the typechecker is real rather than merely configured).
- Plan 051 makes substantial changes to `TenancyPage.tsx`. Landing this plan first means that work gets typechecked as it is written, which is the main reason this is P1.
