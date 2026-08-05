# Plan 046: Fix tenant parameter binding — dialect markers, fail-closed placeholders, and operator corruption

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/core/src/sql/tenant-placeholders.ts packages/core/src/ask.ts packages/core/src/sql/bind.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — Step 5 changes a default in a security-relevant path.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: **Yes, Step 5 only.** Flipping the default `tenantSqlMode` from `"sql-only"` to `"sql-params"` changes what `ask()` returns for callers who never set it — they begin receiving `tenantParams` and marker-bearing SQL instead of inlined literals. Everything is pre-1.0 beta. Step 5 is separable: if the maintainer wants to defer the default flip, Steps 1–4 still stand on their own.

## Why this matters

Four independent defects live in one file, all in the path that injects tenant IDs into generated SQL. Three are outright bugs; the fourth is a default that points the wrong way for a security feature.

The most urgent became worse when PR #168 merged. Business-query parameters are now bound with dialect-correct markers via `markerStyleForDialect`, but the tenant path still hardcodes Postgres `$N`. Since `ask()` appends tenant parameters after business parameters in the *same statement*, a MySQL or SQL Server query can now contain `?` markers for business values and `$1` for tenant values simultaneously. Before #168 the tenant markers were uniformly wrong on non-Postgres engines; now they are inconsistent within a single query, which is harder to diagnose.

The second is a fail-open. When a resolved placeholder has no IDs behind it, the code silently skips substitution and ships SQL still containing the literal text `:tenant_agency_ids`. Depending on the driver that either errors at execution or binds something unintended. For a tenant boundary, the correct response to "I cannot resolve this scope" is to refuse, not to emit a half-substituted statement.

The third corrupts SQL: the `=` → `IN` rewrite matches the `=` inside `!=`, `<=`, and `>=`.

The fourth is `"sql-only"` — string interpolation — being the default output mode, with parameter binding as the opt-in. For values that define a security boundary, that ordering should be reversed.

## Current state

All excerpts from `packages/core/src/sql/tenant-placeholders.ts` at commit `595182d`.

### 1. Postgres-hardcoded markers — lines 149-173

```ts
export function replacePlaceholdersWithParams(
  sql: string,
  resolved: ResolvedPlaceholder[],
  startIndex: number = 1,
): { sql: string; params: unknown[]; nextIndex: number } {
  let result = sql;
  const params: unknown[] = [];
  let idx = startIndex;

  for (const r of resolved) {
    if (r.ids.length === 0) continue;

    if (r.ids.length === 1) {
      const paramRef = `$${idx}`;
      result = replaceOperatorAware(result, r.placeholder, paramRef, false);
      params.push(r.ids[0]!);
      idx++;
    } else {
      const paramRefs = r.ids.map(() => `$${idx++}`);
      const paramList = `(${paramRefs.join(", ")})`;
      result = replaceOperatorAware(result, r.placeholder, paramList, true);
      params.push(...r.ids);
    }
  }
  return { sql: result, params, nextIndex: idx };
}
```

The dialect is **already threaded into this file** — `resolveTenantSql` accepts it at line 216:

```ts
export function resolveTenantSql(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
  mode: TenantSqlOutputMode = "sql-only",
  paramStartIndex: number = 1,
  dialect?: Pick<DialectSpec, "backslashEscapes">,
): TenantPlaceholderResult {
```

but the `Pick` only exposes `backslashEscapes`, so `id` — which `markerStyleForDialect` needs — is not reachable. Widening that `Pick` is most of Step 1.

The primitives to use are in `packages/core/src/sql/bind.ts`:

```ts
export type MarkerStyle = "dollar" | "question" | "atp";

export function markerStyleForDialect(id: BuiltInDialectId): MarkerStyle {
```
```ts
export function formatMarker(style: MarkerStyle, ordinal: number): string {
```

`bind.ts:438-442` shows how `bindPreparedQuery` uses them:

```ts
      return formatMarker("dollar", counters.dollar++);
```
```ts
      return formatMarker("atp", counters.atp++);
```
```ts
      return formatMarker("question", 0);
```

Note the `question` style ignores the ordinal — `?` markers are positional by occurrence order, so the caller must push parameters in exactly the order the markers appear. Read `bind.ts:404-450` in full before writing Step 1.

`DialectSpec` carries `id: DialectId` at `packages/core/src/sql/dialect-spec.ts:24`, and `markerStyleForDialect` takes a `BuiltInDialectId`. Confirm those two types are compatible before assuming a direct pass-through; if `DialectId` is wider, narrow it explicitly rather than casting.

### 2. Silent fail-open on unresolved placeholders — lines 132-134 and 158-159

In `replacePlaceholdersWithLiterals`:

```ts
  for (const r of resolved) {
    if (r.ids.length === 0) continue;
```

and identically in `replacePlaceholdersWithParams`:

```ts
  for (const r of resolved) {
    if (r.ids.length === 0) continue;
```

The empty list originates upstream in `resolvePlaceholders`, which does `const ids = idsByRoot.get(rootInfo.rootId) ?? [];` — so a placeholder naming a root the current scope does not cover resolves to zero IDs and is then skipped, leaving `:tenant_x_ids` verbatim in the output.

### 3. Operator corruption — lines 180-198

```ts
function replaceOperatorAware(
  sql: string,
  placeholder: string,
  replacement: string,
  isMultiple: boolean,
): string {
  if (isMultiple) {
    const eqPattern = new RegExp(
      `=\\s*${escapeRegex(placeholder)}`,
      "g",
    );
    sql = sql.replace(eqPattern, `IN ${replacement}`);

    const inPattern = new RegExp(
      `IN\\s*\\(\\s*${escapeRegex(placeholder)}\\s*\\)`,
      "gi",
    );
    sql = sql.replace(inPattern, `IN ${replacement}`);
  }

  sql = sql.replace(new RegExp(escapeRegex(placeholder), "g"), replacement);
  return sql;
}
```

`eqPattern` is `=\s*:tenant_x_ids`. Against `WHERE a != :tenant_x_ids` it matches the `=` of `!=`, producing `WHERE a !IN ('1','2')` — invalid SQL. Same for `<=` and `>=`. Only reachable when `isMultiple` is true, i.e. a scope with more than one ID.

### 4. Interpolation-by-default — line 216 above, and `packages/core/src/ask.ts:334`

```ts
    const tenantMode = options.tenantSqlMode ?? "sql-only";
```

### How `ask()` combines business and tenant parameters — `packages/core/src/ask.ts:333-345`

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

`dialectSpec` is in scope at the call site, which is what makes Step 1 a local change.

### Conventions

- Errors thrown from tenant code use `TenantScopeError` from `packages/core/src/errors.ts`, which takes a `TenantScopeRejectionReason`. The existing reasons are `MISSING_SCOPE | UNKNOWN_TENANT_ROOT | GLOBAL_WITHOUT_REASON | INVALID_SCOPE_SHAPE`. Step 2 needs a new one — adding to that union is a public-surface addition; do it deliberately and mention it in the changeset.
- Tests colocate; `packages/core/src/sql/tenant-placeholders.test.ts` already exists — extend it.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Placeholder tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-placeholders.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/sql/tenant-placeholders.ts`
- `packages/core/src/sql/tenant-placeholders.test.ts`
- `packages/core/src/errors.ts` — one new `TenantScopeRejectionReason` member (Step 2)
- `packages/core/src/ask.ts` — only the `tenantSqlMode` default and the dialect argument, nothing else
- `packages/core/src/ask.test.ts` — integration cases
- `docs/specs/multi-tenancy.md` and `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` — only if Step 5 lands
- `.changeset/tenant-binding-correctness.md` (create)

**Out of scope** (do NOT touch):
- `packages/core/src/sql/bind.ts`. You consume `markerStyleForDialect` and `formatMarker`; you do not modify them. If they need a change, STOP.
- The business-parameter binding path (`bindPreparedQuery` and its call site in `ask.ts`). This plan only fixes the tenant path so it behaves like the business path already does.
- `packages/core/src/sql/tenant-guardrail.ts` — plan 045 owns it.
- The `subtree` descendant expansion — plan 047 owns it. `buildIdsByRoot` stays as it is.
- Removing `tenantFilters` — plan 048 owns it.
- Rewriting `replaceOperatorAware` to be fully lexer-aware. Step 3 fixes the specific operator bug; making placeholder substitution quote-aware is a larger change and belongs with plan 050's rewriting work.

## Git workflow

- Branch: `advisor/046-tenant-binding-correctness`
- One commit per step — these are four separable fixes and a reviewer will want them apart.
- Commit style e.g. `fix(core): emit dialect-correct markers for tenant parameters`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Emit dialect-correct parameter markers

Widen the `dialect` parameter on `resolveTenantSql` (line 216) and on `replacePlaceholdersWithLiterals` (line 130) from `Pick<DialectSpec, "backslashEscapes">` to `Pick<DialectSpec, "id" | "backslashEscapes">`, and thread it into `replacePlaceholdersWithParams` as a new parameter.

In `replacePlaceholdersWithParams`, replace both hardcoded `` `$${idx}` `` sites with `formatMarker(style, ordinal)` where `style = markerStyleForDialect(dialect.id)`. Keep `dialect` optional and default to `"dollar"` when it is absent, preserving today's behavior for callers that do not pass one.

Two details that matter:

- **`question` style ignores the ordinal.** With `?` markers, correctness depends entirely on parameters being pushed in the same order the markers appear in the statement. The existing loop already pushes in order; do not reorder it.
- **`nextIndex` accounting must stay correct** even for `question` style, because `ask.ts` uses `businessParamCount + 1` as the start index and the two paths must not disagree about how many slots were consumed.

Import from `./bind.js`:

```ts
import { formatMarker, markerStyleForDialect, type MarkerStyle } from "./bind.js";
```

Then update the `ask.ts` call sites so the full `dialectSpec` reaches `resolveTenantSql` — it is already being passed, so this may be a no-op beyond the widened type. Confirm.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0, and:
```bash
grep -c '`\$\${idx}`' packages/core/src/sql/tenant-placeholders.ts
```
→ `0`.

### Step 2: Fail closed when a placeholder cannot be resolved

Replace both `if (r.ids.length === 0) continue;` guards (lines 134 and 159) with a thrown error. A tenant placeholder that resolves to no IDs means the model filtered on a root the caller's scope does not cover — emitting SQL with the placeholder still in it is the worst available outcome.

Add a new member to `TenantScopeRejectionReason` in `packages/core/src/errors.ts`:

```ts
  | "UNRESOLVED_TENANT_PLACEHOLDER"
```

and throw:

```ts
    if (r.ids.length === 0) {
      throw new TenantScopeError(
        `Generated SQL references ${r.placeholder} but the current scope provides no IDs for tenant root '${r.rootId}'. ` +
          `Refusing to emit SQL with an unsubstituted tenant placeholder.`,
        "UNRESOLVED_TENANT_PLACEHOLDER",
      );
    }
```

Before writing this, check whether any existing test relies on the skip-and-continue behavior — `grep -n "ids: \[\]" packages/core/src/sql/tenant-placeholders.test.ts`. If one does, it is asserting the fail-open; update it to expect the throw and note the change.

Note the interaction with `global` scope: `resolveTenantSql` returns early for `access.kind === "global"` (line 220) before any of this runs, so global scope is unaffected.

**Verify**: `pnpm --filter @askdb/core test` → all pass (after updating any test that asserted the old behavior).

### Step 3: Stop the `=` → `IN` rewrite from matching compound operators

In `replaceOperatorAware`, change `eqPattern` so it does not match an `=` preceded by `!`, `<`, or `>`. A negative lookbehind is the smallest correct fix:

```ts
    const eqPattern = new RegExp(
      `(?<![!<>])=\\s*${escapeRegex(placeholder)}`,
      "g",
    );
```

Node 22 (the repo's minimum, per `engines.node`) supports lookbehind, so this is safe. If you prefer to avoid lookbehind, capture the preceding character and re-emit it — but do not silently change which operators are rewritten.

Consider what *should* happen for `a != :tenant_x_ids` with multiple IDs. The honest answer is that `NOT IN` is the semantically correct rewrite, but a negated tenant predicate is almost certainly a model error, and quietly "fixing" it into `NOT IN` would produce a query that runs and returns the wrong rows. Leave it unrewritten — the placeholder still gets substituted by the final unconditional replace at line 197, and the resulting `a != ('1','2')` will fail at the database, which is the correct loud failure. Add a comment saying exactly that, so the next reader does not "improve" it.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-placeholders.test.ts` → all pass, including the new operator cases from the test plan.

### Step 4: Tests for Steps 1–3

Extend `packages/core/src/sql/tenant-placeholders.test.ts`, reusing its existing policy and scope fixtures. Read the file first — line 61 already has a `subtree` fixture you can copy the shape from.

- **Markers**: for each of `postgres`, `mysql`, `sqlite`, `sqlserver`, resolve a single-ID scope in `sql-params` mode and assert the emitted marker matches that dialect's style. Then a multi-ID scope for each. Then assert `params` length equals the number of IDs in every case.
- **Marker ordering for `question` style**: two placeholders, multi-ID each, on MySQL — assert `params` order matches the left-to-right order of `?` markers in the output SQL. This is the case that silently corrupts data if Step 1 gets ordering wrong.
- **`nextIndex`**: assert it advances by the number of IDs consumed, for both `dollar` and `question` styles.
- **Fail closed**: a scope whose access covers root A, and SQL containing root B's placeholder → expect `TenantScopeError` with reason `UNRESOLVED_TENANT_PLACEHOLDER`, in both `sql-only` and `sql-params` modes.
- **Global scope unaffected**: `access.kind === "global"` with an unresolvable placeholder present → no throw, SQL returned unchanged.
- **Operators**: with a multi-ID scope, assert `WHERE a = :tenant_x_ids` becomes `IN (...)`; and that `!=`, `<=`, `>=` are each left with their operator intact and no `!IN` / `<IN` / `>IN` anywhere in the output.
- **Regression**: the existing single-ID and `IN (:placeholder)` cases still behave identically.

Add to `packages/core/src/ask.test.ts` one integration case proving the #168 interaction is fixed: a MySQL dialect, a query with both a business parameter and a tenant placeholder, `tenantSqlMode: "sql-params"` → assert the final SQL contains no `$1` and that all markers are `?`.

**Verify**: `pnpm --filter @askdb/core test` → all pass, at least 12 new cases.

### Step 5 (BREAKING — separable): make parameter binding the default

Change the default in two places so tenant IDs are bound rather than interpolated unless a caller explicitly opts out:

- `packages/core/src/sql/tenant-placeholders.ts:216` — `mode: TenantSqlOutputMode = "sql-params"`
- `packages/core/src/ask.ts:334` — `const tenantMode = options.tenantSqlMode ?? "sql-params";`

Then update the JSDoc on `AskPipelineOptions.tenantSqlMode` (`packages/core/src/ask.ts:167`) to state the new default and explain that `"sql-only"` inlines escaped literals and exists for callers that cannot bind parameters — for example when handing SQL to a tool that takes a single string.

Update `docs/specs/multi-tenancy.md` and `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` wherever they state or imply the old default. Find them with `grep -rn "sql-only" docs apps/docs-site/src`.

Run the full suite and expect breakage in tests that assumed inlined literals. Each one must be updated to either pass `tenantSqlMode: "sql-only"` explicitly (where the test is specifically about interpolation) or assert the parameterized shape (where the test is about tenant scoping generally). **Do not** update a test by weakening its assertion.

**If more than about 10 existing tests break, STOP and report** — that volume suggests the default flip has wider consequences than this plan anticipated and the maintainer should decide whether to ship it separately.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

### Step 6: Changeset

Create `.changeset/tenant-binding-correctness.md` — **minor** for `@askdb/core` (a new error reason and, if Step 5 landed, a changed default).

The body must cover, as separate bullets: dialect-correct tenant markers (with the note that mixed `?`/`$1` in one statement was possible on non-Postgres engines after #168); the new `UNRESOLVED_TENANT_PLACEHOLDER` failure replacing silent emission of unsubstituted placeholders; the `!=` / `<=` / `>=` corruption fix; and — if Step 5 landed — the default `tenantSqlMode` change, with the one-line remedy for callers who want the old behavior (`tenantSqlMode: "sql-only"`).

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

Covered in Step 4 above, plus any test updates forced by Steps 2 and 5. Use `packages/core/src/sql/tenant-placeholders.test.ts` as the structural pattern for unit cases and `packages/core/src/ask.test.ts` for the integration case.

The three highest-value cases, if time is short: the `question`-style parameter-ordering test, the fail-closed test in both modes, and the `!=` non-corruption test. Each pins a defect that is silent rather than loud.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0 with at least 12 new test cases
- [ ] ``grep -c '`\$\${idx}`' packages/core/src/sql/tenant-placeholders.ts`` returns `0`
- [ ] `grep -c "if (r.ids.length === 0) continue;" packages/core/src/sql/tenant-placeholders.ts` returns `0`
- [ ] `grep -n "UNRESOLVED_TENANT_PLACEHOLDER" packages/core/src/errors.ts` returns a match
- [ ] `grep -n "(?<!\[!<>\])=" packages/core/src/sql/tenant-placeholders.ts` returns a match
- [ ] `git diff --name-only packages/core/src/sql/bind.ts` is empty (shared binder untouched)
- [ ] `git diff --name-only packages/core/src/sql/tenant-guardrail.ts` is empty (plan 045's file untouched)
- [ ] If Step 5 landed: `grep -n 'tenantSqlMode ?? "sql-params"' packages/core/src/ask.ts` returns a match, and no test was updated by weakening an assertion
- [ ] `.changeset/tenant-binding-correctness.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `markerStyleForDialect` takes a `BuiltInDialectId` that is narrower than `DialectSpec["id"]` in a way you cannot resolve without a type assertion. Report the mismatch; do not cast.
- Making the tenant path use `question` markers breaks the business/tenant ordering contract in `ask.ts` — for example if business parameters are pushed in a different order than their markers appear. That is a pre-existing defect in the business path and belongs in its own fix.
- More than about 10 existing tests break in Step 5.
- Step 2's throw fires in an existing test that represents a legitimate scenario — i.e. there is a real, supported case where a placeholder should resolve to zero IDs. If so, the fail-closed design needs revisiting; report the scenario.
- You find that `replaceOperatorAware` also substitutes placeholders inside string literals. It does — it is a plain regex over the whole statement. That is a real weakness, but fixing it needs the quote-aware scanner and belongs with plan 050. Note it and move on; do not expand scope.

## Maintenance notes

- **The tenant path and the business path must stay in agreement about parameter ordinals.** `ask.ts` computes `paramStartIndex = businessParamCount + 1`. If either side ever changes how it counts slots — particularly for list expansion, where one logical parameter can consume many ordinals — both must change together. The `nextIndex` test from Step 4 is the tripwire.
- **The right long-term fix is one binder, not two.** After this plan the tenant path *mimics* `bindPreparedQuery` rather than using it. Folding tenant placeholders into the same `PreparedQuery` manifest — they already carry `source: "tenant"` in `bind.ts:33` — would delete this duplication entirely. Deliberately deferred; it is a larger refactor and this plan's job is to stop the bleeding.
- **Step 5's default flip is the one to scrutinize in review.** Confirm no test was "fixed" by loosening what it asserts, and that the docs no longer describe `sql-only` as the default anywhere.
- `replaceOperatorAware` remains regex-based and remains quote-unaware. Plan 050's spike should decide whether it survives at all.
