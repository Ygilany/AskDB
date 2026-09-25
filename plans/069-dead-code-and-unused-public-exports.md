# Plan 069: Delete internal dead code and deprecate unused public exports

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)**:
>
> ```bash
> # Review PRs that touch these files must be in (avoids conflicts): #185, #192, #194, #197, #198
> for n in 185 192 194 197 198; do gh pr view $n --repo Ygilany/AskDB --json number,state -q '"\(.number) \(.state)"'; done   # → all MERGED
> # Every symbol still exists and still has zero non-definition callers (the problem still exists):
> for s in isScopeThroughColumn isScopeThroughJoin clearAskDbRuntime getIntrospectionPlan formatUsageInline emptyToUndefined formatSchemaForPrompt hasAnyColumnDescribable DEFAULT_LOCAL_POSTGRES_URL isEnumCandidate parseListInput; do
>   echo "== $s"; git grep -nw "$s" -- ':!**/CHANGELOG.md' ':!plans/**'
> done
> git grep -n "Drawer\b" -- apps/studio/src/web ; git grep -n "ui/panel" -- apps/studio/src/web
> ```
>
> Expected: each symbol appears only at the definition sites (and, for public ones, the `src/index.ts` re-export; for `isEnumCandidate`/`parseListInput`, also `packages/enrich/src/draft.test.ts`). `Drawer` appears only in `apps/studio/src/web/components/shell/Drawer.tsx` and a CSS comment; `ui/panel` has no importers. **Any other caller → that symbol is out of this plan; note it and continue with the rest.**

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — internal deletions are verified caller-free; public symbols are only deprecated, not removed.
- **Depends on**: PRs #185, #192, #194, #197, #198 merged (they edit the same files). Removal of the deprecated public symbols is **not** in this plan: it belongs to the pre-1.0 breaking window with plan 060 (shim removal) and plan 067 Step 8 (GA).
- **Category**: tech-debt
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No — only symbols unreachable from any package entry point are deleted; public ones get `@deprecated` JSDoc.

## Why this matters

Dead code in a codebase about to go public costs reviewers and newcomers time, and public exports nobody uses become API commitments at 1.0. Every symbol below was checked on `c7404d4` across code, tests, docs-site content, `docs/`, `examples/`, READMEs and `.changeset/` (excluding `node_modules`, `dist`, `.turbo`). Package entry points: `@askdb/core`, `@askdb/config`, `@askdb/enrich` and `@askdb/studio` each export only `"."`, so a symbol is public iff its package's `src/index.ts` re-exports it. There is no unused-export lint (no knip/ts-prune; `noUnusedLocals` is not set anywhere), which is how these accumulated.

## Current state

### A. Internal dead code (not reachable from any package entry) → delete

| Symbol | Definition | Evidence |
|---|---|---|
| `isScopeThroughColumn`, `isScopeThroughJoin` | `packages/core/src/schema/v2/tenant-policy-loader.ts` under the comment `// Helpers — scope-through classification for mixed tables` | `packages/core/src/schema/v2/index.ts` re-exports only `parseTenantPolicyMarkdown`, `normalizeTenantPolicy` from that file; `loader.ts` imports the same two. Zero references besides the definitions. |
| `clearAskDbRuntime` | `packages/config/src/runtime-store.ts`: `export function clearAskDbRuntime(): void { stored = undefined; }` | Not re-exported by `packages/config/src/index.ts` (which exports `mergeAskDbFlatIntoEnvMap`, `resetAskDbRuntimeForTests`, `setAskDbRuntimeForTests` from that file). Same body as `resetAskDbRuntimeForTests`. Zero references. |
| `getIntrospectionPlan` | `apps/studio/src/web/api.ts`: `export async function getIntrospectionPlan(): Promise<IntrospectionPlanDto> { return api<IntrospectionPlanDto>("/api/introspect/status"); }` | Zero callers. `IntrospectionPlanDto` is imported in `web/api.ts` only for it — drop that import too if unused afterwards. The server route `GET /api/introspect/status` stays (it has a server test; removing an HTTP route is out of scope). |
| `Drawer` | `apps/studio/src/web/components/shell/Drawer.tsx` (whole file) | No importers. Its CSS is only used by it: in `apps/studio/src/web/styles.css`, `--shadow-drawer` (≈line 42), the block after the `/* Drawer (retrieval inspector) */` comment (`.drawer-overlay`, `.drawer`, `.drawer-hd`, `.drawer-bd`, ≈lines 1009–1062), and `.drawer { width: 100%; }` in a media query (≈line 1673). |
| `Panel` | `apps/studio/src/web/components/ui/panel.tsx` (whole file; `Panel` is its only export) | No importers of `ui/panel`; `git grep -w Panel apps/studio/src` finds only the definition. |
| `formatUsageInline`, `emptyToUndefined` | `apps/studio/src/web/lib/format.ts` | Zero callers. After removing `formatUsageInline`, the `import type { StudioRequestUsageDto } from "@/shared/api"` at the top of `format.ts` becomes unused — remove it. `formatNumber` stays (used by `rag-context.tsx`, `OverviewPage.tsx`, `RagIndexPage.tsx`). |
| `formatList`, `formatUnknown` (additional finding) | `apps/studio/src/web/lib/format.ts` | Never imported: `components/ui/list-input.tsx` defines its own local `formatList`; `views/playground/PlaygroundPage.tsx` and `views/tenancy/TenancyPage.tsx` each define a local `formatUnknown`. Delete the unused `lib/format.ts` exports (do not refactor the local copies in this plan). |

### B. Public exports with zero in-repo callers → deprecate now, remove before 1.0

| Symbol | Package / definition | Re-export | Callers | Replacement to name in `@deprecated` |
|---|---|---|---|---|
| `formatSchemaForPrompt` | `@askdb/core`, `packages/core/src/schema/normalize.ts`: `/** Same DDL as {@link formatSchemaForNlToSql} with default options (sensitive names included, tagged). */ export function formatSchemaForPrompt(schema, options?) { return formatSchemaForNlToSql(schema, options).ddl; }` | `packages/core/src/index.ts` (from `./schema/normalize.js`) | none | `formatSchemaForNlToSql(schema, options).ddl` |
| `hasAnyColumnDescribable` | `@askdb/enrich`, `packages/enrich/src/draft.ts`: `/** Are any per-column describable fields populated? */` | `packages/enrich/src/index.ts` | none | none (inline the check) |
| `isEnumCandidate` | `@askdb/enrich`, `packages/enrich/src/draft.ts`: `/** Is the column type a candidate for an enum field? (text-y types). */` | `packages/enrich/src/index.ts` | **tests only** (`packages/enrich/src/draft.test.ts`) | none |
| `parseListInput` | `@askdb/enrich`, `packages/enrich/src/draft.ts`: `/** Parse a comma-separated string into a trimmed list (empty entries dropped). */` | `packages/enrich/src/index.ts` | **tests only** (`draft.test.ts`); Studio has its own `parseList` in `web/lib/format.ts` | `value.split(",").map((s) => s.trim()).filter(Boolean)` |
| `DEFAULT_LOCAL_POSTGRES_URL` | `@askdb/config`, `packages/config/src/defaults.ts`: `export const DEFAULT_LOCAL_POSTGRES_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres";` | `packages/config/src/index.ts` | none | none (define your own local default) |

None of the B symbols appear in `apps/docs-site/src/content/docs`, `docs/`, `examples/`, READMEs or `.changeset/`. Deprecation convention to follow: the repo already ships deprecated packages with a description note ("[Deprecated] … removed before 1.0."); for symbols use TSDoc `@deprecated` so editors strike them through.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install / build | `pnpm install && pnpm build` | exit 0 |
| Lint (incl. Studio web `tsc -p tsconfig.web.json` + eslint) | `pnpm lint` | exit 0 |
| Package tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts`, same for `@askdb/config`, `@askdb/enrich`, `@askdb/studio` | all pass |
| Studio client build | `pnpm --filter @askdb/studio build` | exit 0 (vite build of the web UI) |
| Full | `pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**: `packages/core/src/schema/v2/tenant-policy-loader.ts`, `packages/core/src/schema/normalize.ts`, `packages/config/src/runtime-store.ts`, `packages/config/src/defaults.ts`, `packages/enrich/src/draft.ts`, `apps/studio/src/web/api.ts`, `apps/studio/src/web/components/shell/Drawer.tsx` (delete), `apps/studio/src/web/components/ui/panel.tsx` (delete), `apps/studio/src/web/lib/format.ts`, `apps/studio/src/web/styles.css`, `.changeset/deprecate-unused-exports.md` (create).

**Out of scope**: removing any B symbol (pre-1.0 breaking window, see Maintenance); the `GET /api/introspect/status` route and its test; deduplicating the local `formatList`/`formatUnknown`/`parseList` copies; adding knip/ts-prune (worth a separate plan); `packages/enrich/src/draft.test.ts` (tests of deprecated-but-present functions stay until removal).

## Git workflow

- Branch: `plan/069-dead-code-and-unused-exports`
- Two commits: `refactor: delete unreachable internal helpers` and `chore: deprecate unused public exports`.
- One PR; do not merge.

## Steps

### Step 1: Delete internal dead code (table A)

Delete each symbol/file exactly as listed, plus the now-unused imports and the Drawer CSS. For `styles.css`, delete only rules whose selectors are `drawer`-prefixed classes and the `--shadow-drawer` custom property; first confirm `git grep -n "drawer\|shadow-drawer" -- apps/studio/src/web ':!apps/studio/src/web/styles.css'` returns only `Drawer.tsx` (which you are deleting).

**Verify**:
- `git grep -nw "isScopeThroughColumn\|isScopeThroughJoin\|clearAskDbRuntime\|getIntrospectionPlan\|formatUsageInline\|emptyToUndefined" -- packages apps` → no matches
- `git grep -n "drawer" -- apps/studio/src/web` → no matches; `test ! -e apps/studio/src/web/components/shell/Drawer.tsx && test ! -e apps/studio/src/web/components/ui/panel.tsx` → exit 0
- `git grep -n "export function formatList\|export function formatUnknown" -- apps/studio/src/web/lib/format.ts` → no matches
- `pnpm build && pnpm lint` → exit 0

### Step 2: Deprecate public exports (table B)

Prepend to each symbol's existing JSDoc (keep the original description line):
```ts
/**
 * <existing description>
 *
 * @deprecated Unused by AskDB and scheduled for removal before 1.0. <Replacement sentence from table B, or "No replacement.">
 */
```
For `DEFAULT_LOCAL_POSTGRES_URL` (no JSDoc today) add one. Do not change behavior, signatures, or re-exports.

**Verify**: `git grep -n "@deprecated Unused by AskDB" -- packages` → 5 matches (normalize.ts ×1, draft.ts ×3, defaults.ts ×1); `pnpm build && pnpm lint` → exit 0.

### Step 3: Changeset and gates

Create `.changeset/deprecate-unused-exports.md` with **patch** bumps for `@askdb/core`, `@askdb/config`, `@askdb/enrich`, `@askdb/studio` (Studio web/source changed, so the Changesets `status` check requires an entry). Body: "Deprecated `formatSchemaForPrompt` (core), `hasAnyColumnDescribable` / `isEnumCandidate` / `parseListInput` (enrich) and `DEFAULT_LOCAL_POSTGRES_URL` (config); they are unused and will be removed before 1.0. Removed unreachable internal helpers." Then `pnpm changeset status` → no major bumps.

**Verify**: `pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

No new tests (test-audit authoring gate: deleting unreachable code and adding JSDoc has no observable behavior to protect). The proof is `pnpm lint` (typechecks server and web; catches any missed caller) plus the full test suite and the Studio vite build. `packages/enrich/src/draft.test.ts` keeps testing `isEnumCandidate`/`parseListInput` until they are removed — at removal time, delete those tests with them (the test-audit "dead production code whose only callers are tests" pattern).

## Docs impact

None: no B symbol is documented on the docs site or in `docs/` (verified). Do not add them to docs.

## Changeset guidance

Patch for all four packages (deprecation is non-breaking). The later removal is breaking → minor while pre-1.0 (or part of the 1.0 RC per plan 067).

## Done criteria

- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight` exit 0
- [ ] Step 1 and Step 2 verify greps return the stated results
- [ ] `.changeset/deprecate-unused-exports.md` exists; `pnpm changeset status` shows only patch bumps from it
- [ ] `git status` shows only in-scope files changed

## STOP conditions

- The readiness grep finds a caller for any symbol (code, test, docs, example) that this plan doesn't list — skip that symbol and report it.
- `pnpm lint` fails after a deletion with an error pointing at a real usage (e.g. dynamic import or string-based lookup) — restore and report.
- A symbol in table A turns out to be re-exported from a package `src/index.ts` on current `main` (it would be public) — move it to table B treatment instead.

## Maintenance notes

- **Removal before 1.0**: add the five table-B symbols (and their `draft.test.ts` cases) to plan 060's removal PR, or to the GA PR in plan 067 Step 8 — whichever lands first in the breaking window. Grep target: `git grep -n "@deprecated Unused by AskDB"`.
- `GET /api/introspect/status` now has no web caller; decide separately whether the UI should use it or the route should go.
- Follow-up worth a plan: add `knip` (or `ts-prune`) to `pnpm lint` so unused exports can't accumulate again.
