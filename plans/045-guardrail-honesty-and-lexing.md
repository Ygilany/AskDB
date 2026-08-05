# Plan 045: Describe the tenant guardrail honestly, and stop it matching inside string literals

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 595182d..HEAD -- packages/core/src/sql/tenant-guardrail.ts packages/core/src/sql/bind.ts docs/specs/multi-tenancy.md docs/contracts/tenant-policy.md apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `595182d`, 2026-08-05
- **Breaking**: No. Behavior gets slightly stricter (fewer false passes), which can surface new warnings in `warn` mode or new rejections in `strict` mode for queries that were only passing by accident. Call that out in the changeset.

## Why this matters

`validateTenantGuardrails` is currently documented as a safety net that fails closed. Its docstring says it *"Falls back to conservative rejection when the SQL cannot be proven safe."* It does the opposite: it passes a table as soon as the tenant column name appears **anywhere** in the SQL string, in any context.

Two consequences, and they need different fixes.

The first is a documentation defect, and it is the more dangerous one. An integrator reading that docstring will reasonably conclude that `strict` mode is a security boundary and design their application around it. It is not one, and no amount of tightening in this plan will make it one — a regex over SQL text cannot distinguish a `SELECT` list from a `WHERE` clause, cannot see `OR 1=1`, and cannot see negation. The description must match reality.

The second is a real and cheaply fixable weakness. The matcher runs against raw, unlexed SQL, so `WHERE note = 'agency_id'` counts as a tenant predicate. PR #168 merged a proper SQL tokenizer into this package for exactly this class of problem. Scanning only the code regions eliminates the string-literal and quoted-identifier false positives for a few lines of work.

These land together deliberately. Shipping the hardening alone would look like the guardrail became trustworthy; shipping the honesty alone leaves a known false-positive class in place.

## Current state

### The misleading docstring — `packages/core/src/sql/tenant-guardrail.ts:18-32`

```ts
/**
 * Validate generated SQL against the tenant policy and runtime scope.
 *
 * Uses heuristic pattern matching to verify that tenant-scoped tables
 * have the required predicates. Falls back to conservative rejection
 * when the SQL cannot be proven safe.
 *
 * In `strict` mode, throws `TenantGuardrailError` on failure.
 * In `warn` mode, returns warnings without throwing.
 */
export function validateTenantGuardrails(
  sql: string,
  policy: NormalizedTenantPolicy,
  scope: TenantScope,
): TenantGuardrailResult {
```

### The matcher — `packages/core/src/sql/tenant-guardrail.ts:181-197`

```ts
function normalizeSql(sql: string): string {
  return sql.toLowerCase();
}

function mentionsTable(normalizedSql: string, tableName: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(tableName.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function mentionsIdentifier(normalizedSql: string, identifier: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(identifier.toLowerCase())}\\b`);
  return pattern.test(normalizedSql);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

`normalizeSql` is called once at the top of `validateTenantGuardrails` (line 39: `const normalizedSql = normalizeSql(sql);`) and the result is threaded into `checkScopedTable`, `checkPolymorphicTable`, and the unknown-table loop.

Concretely, all of these pass the guardrail today for a policy that scopes `orders` through `agency_id`:

- `SELECT * FROM orders WHERE note = 'agency_id'` — matched inside a string literal. **Step 2 fixes this.**
- `SELECT agency_id FROM orders` — the column is selected, never filtered. Not fixable here.
- `SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) OR 1=1` — not fixable here.
- `SELECT * FROM orders WHERE agency_id NOT IN (:tenant_agency_ids)` — not fixable here.

### The tokenizer that #168 made available — `packages/core/src/sql/bind.ts:65-78`

```ts
export type SqlSpanKind = "code" | "quoted";

export type SqlSpan = {
```

```ts
/**
 * Tokenize SQL into contiguous code vs quoted regions.
 * Recognizes single-quoted strings (doubled-quote escapes), double-quoted
 * identifiers, PostgreSQL dollar-quoting, MySQL backticks, and SQL Server brackets.
 */
export function tokenizeSqlSpans(sql: string): SqlSpan[] {
```

A `SqlSpan` carries `{ kind, start, end }` as offsets into the original string. `tokenizeSqlSpans` is exported from `bind.ts` but **not** re-exported from `packages/core/src/sql/index.ts` or the package barrel — it is an intra-package utility, which is exactly how this plan will use it (`import { tokenizeSqlSpans } from "./bind.js";`). Do not add it to the public barrel.

`bind.ts` also exports `stripSqlStringLiterals` (line 180), already consumed by `packages/core/src/sql/validate.ts` for the read-only keyword checks. Either primitive would work here; the plan uses `tokenizeSqlSpans` because it preserves offsets, which keeps the change to a filter over regions rather than a rewrite of the string.

### Where the guardrail is invoked — `packages/core/src/sql/generate.ts:145-148`

```ts
    // Tenant guardrail validation (after base validation, before returning)
    let tenantGuardrail: TenantGuardrailResult | undefined;
    if (deps.tenantPolicy && deps.tenantScope) {
      tenantGuardrail = validateTenantGuardrails(sql, deps.tenantPolicy, deps.tenantScope);
```

### Docs that describe the guardrail

- `docs/specs/multi-tenancy.md` — the spec. Line 42 already contains the only RLS mention in the repo, inside a non-goals list: `- Row-level security (RLS) DDL generation — tenant predicates are SQL WHERE clauses; RLS is still recommended as a defense-in-depth layer`. Note the framing is currently backwards from what Step 3 will assert; read the surrounding section before editing.
- `docs/contracts/tenant-policy.md` — the contract.
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx` — the user-facing guide.

Read all three and find every claim about what `strict` mode guarantees before writing Step 3.

### Conventions

- Tests colocate as `*.test.ts`; `packages/core/src/sql/tenant-guardrail.test.ts` already exists — extend it rather than creating a new file.
- Docs-site pages are hand-authored Starlight MDX and do **not** mirror `docs/*.md`; both need editing separately.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Guardrail tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts` | all pass |
| Core tests | `pnpm --filter @askdb/core test` | all pass |
| Full gate | `pnpm build && pnpm lint && pnpm test` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/sql/tenant-guardrail.ts`
- `packages/core/src/sql/tenant-guardrail.test.ts`
- `docs/specs/multi-tenancy.md`
- `docs/contracts/tenant-policy.md`
- `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`
- `.changeset/tenant-guardrail-honesty.md` (create)

**Out of scope** (do NOT touch):
- **Renaming the exported function.** `validateTenantGuardrails` is exported from the package barrel and consumers may import it. A rename is a separate breaking change; this plan corrects the description, not the name.
- The warning rule codes in `packages/core/src/errors.ts` (`TenantGuardrailRuleCode`). They are part of the public surface and appear in host logs.
- `packages/core/src/sql/bind.ts` — you are a consumer of the tokenizer, not its author. If it needs a change, that is a STOP condition.
- Making the guardrail actually sound — clause-position awareness, `OR`/negation analysis, subquery scoping. That requires real query rewriting and is the subject of plan 050's design spike. Explicitly do not attempt it here.
- `packages/core/src/sql/validate.ts` (the read-only SELECT guardrail). Different check, different concern.

## Git workflow

- Branch: `advisor/045-guardrail-honesty-and-lexing`
- Commit style e.g. `fix(core): scan tenant predicates outside quoted SQL regions`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the docstring to match behavior

Replace the docstring at `packages/core/src/sql/tenant-guardrail.ts:18-27` with an accurate one. It must state plainly: this is a best-effort lint over generated SQL, not a security boundary; it checks that expected identifiers *appear* in the statement, not that they appear in a filtering position; and enforcement must come from the database (row-level security) or from the host applying its own predicate.

Target shape:

```ts
/**
 * Best-effort lint of generated SQL against the tenant policy and runtime scope.
 *
 * **This is not a security boundary.** It checks that the identifiers a policy
 * expects are *present* in the statement — it does not parse the query, so it
 * cannot tell a `SELECT` list from a `WHERE` clause, and it cannot detect
 * `OR`-widened, negated, or subquery-scoped predicates. A query that mentions
 * the right column in the wrong place will pass.
 *
 * Its purpose is to catch obvious model mistakes early and cheaply. Real
 * enforcement must come from the database (row-level security) or from the
 * host applying the tenant predicate itself — see
 * `docs/integration/tenant-enforcement.md`.
 *
 * Identifier matching runs only over non-quoted regions of the statement, so
 * values inside string literals do not count as predicates.
 *
 * In `strict` mode, throws `TenantGuardrailError` on failure.
 * In `warn` mode, returns warnings without throwing.
 */
```

The `docs/integration/tenant-enforcement.md` reference points at the page plan 049 creates. If plan 049 has not landed, still write the reference — it is the correct destination and the docs plan will create the file. Note it in your report.

**Verify**: `grep -c "conservative rejection" packages/core/src/sql/tenant-guardrail.ts` → `0`.

### Step 2: Match identifiers only outside quoted regions

Import the tokenizer at the top of `packages/core/src/sql/tenant-guardrail.ts`:

```ts
import { tokenizeSqlSpans } from "./bind.js";
```

Change `normalizeSql` so that, instead of merely lowercasing, it blanks out every `quoted` span while preserving offsets — replacing each quoted region with an equal number of spaces. Preserving length keeps the function a drop-in for the existing call sites and keeps `\b` word-boundary semantics intact at the seams.

```ts
/**
 * Lowercase the statement and blank out quoted regions, preserving length so
 * offsets and word boundaries are unaffected. Identifier checks then cannot
 * match text inside string literals or quoted identifiers.
 */
function normalizeSql(sql: string): string {
  const lowered = sql.toLowerCase();
  let out = "";
  let cursor = 0;
  for (const span of tokenizeSqlSpans(sql)) {
    if (span.kind !== "quoted") continue;
    out += lowered.slice(cursor, span.start);
    out += " ".repeat(span.end - span.start);
    cursor = span.end;
  }
  out += lowered.slice(cursor);
  return out;
}
```

Confirm before writing that `tokenizeSqlSpans` returns spans in ascending, non-overlapping offset order — read `bind.ts:78-174`. If it does not, that is a STOP condition.

Change nothing else. `mentionsTable`, `mentionsIdentifier`, `checkScopedTable`, and `checkPolymorphicTable` all keep working unchanged, because they receive the same lowercased-and-same-length string they always did.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0, and `pnpm --filter @askdb/core test` → all existing tests still pass.

### Step 3: Correct every doc claim about what the guardrail guarantees

Read `docs/specs/multi-tenancy.md`, `docs/contracts/tenant-policy.md`, and `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`. Find every statement implying `strict` mode prevents cross-tenant access, and correct it to the framing from Step 1: the guardrail is an early-warning lint; enforcement belongs in the database or the host.

Add a short, clearly marked callout to the docs-site guide — use whatever admonition component that page already uses; check with `grep -n ":::" apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`. It should say, in two or three sentences, that AskDB's tenant checks are heuristic, that they do not parse SQL, and that production deployments should enforce tenancy in the database.

In `docs/specs/multi-tenancy.md:42`, the existing non-goals line frames RLS as an optional extra. Invert it: RLS is the recommended enforcement layer, and AskDB's checks are the defense in depth, not the other way round.

**Verify**: `pnpm docs:build` → exit 0.

### Step 4: Tests

Extend `packages/core/src/sql/tenant-guardrail.test.ts`. Read it first and reuse its existing policy/scope fixtures rather than building new ones.

New cases:

1. **The bug this plan fixes.** With a policy scoping `orders` via `agency_id`, the SQL `SELECT * FROM orders WHERE note = 'agency_id'` must now produce a `MISSING_TENANT_PREDICATE` warning. Before this change it passed.
2. Same for a double-quoted identifier: `SELECT * FROM orders WHERE note = "agency_id"`.
3. **No regression on the legitimate case**: `SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids)` still passes.
4. A query with a quoted region *and* a real predicate — e.g. `SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) AND note = 'agency_id'` — still passes. This is the one most likely to break if the offset arithmetic in Step 2 is wrong.
5. **Documented-limitation tests.** Add these with comments marking them as known-unsound, so the limits are pinned in the suite rather than living only in prose:
   - `SELECT agency_id FROM orders` (no `WHERE`) — currently **passes**; assert that it passes and comment that this is a known limitation the lint cannot detect.
   - `SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) OR 1=1` — currently **passes**; same treatment.

Case 5 is deliberate. Asserting current unsound behavior with an explanatory comment documents the boundary for the next reader and will fail loudly if plan 050's work later changes it — which is the correct signal at that point.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts` → all pass, at least 6 new cases.

### Step 5: Changeset and full gate

Create `.changeset/tenant-guardrail-honesty.md` — **patch** for `@askdb/core`. The body must: state that tenant identifier matching now ignores quoted regions, so a tenant column name appearing inside a string literal no longer counts as a predicate; warn that this can surface new warnings in `warn` mode or new rejections in `strict` mode for queries that previously passed by accident; and state explicitly that the guardrail is a lint and not a security boundary, pointing at the enforcement docs.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- Extend `packages/core/src/sql/tenant-guardrail.test.ts` with the six cases in Step 4, reusing that file's existing fixture style.
- Case 4 (quoted region plus a real predicate) is the offset-arithmetic regression guard for Step 2.
- Case 5's two known-limitation tests are intentional documentation-as-test; keep the explanatory comments.
- No existing test should need modification. If one does, the change is stricter than intended — investigate before editing it.
- Verification: `pnpm --filter @askdb/core test` → all pass.

## Done criteria

ALL must hold:

- [ ] `grep -c "conservative rejection" packages/core/src/sql/tenant-guardrail.ts` returns `0`
- [ ] `grep -c "not a security boundary" packages/core/src/sql/tenant-guardrail.ts` returns at least `1`
- [ ] `grep -n "tokenizeSqlSpans" packages/core/src/sql/tenant-guardrail.ts` returns a match
- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0 with at least 6 new guardrail test cases
- [ ] `pnpm docs:build` exits 0
- [ ] `git diff --name-only packages/core/src/sql/bind.ts` is empty (tokenizer untouched)
- [ ] `git diff --name-only packages/core/src/errors.ts` is empty (rule codes untouched)
- [ ] `grep -rn "tokenizeSqlSpans" packages/core/src/index.ts packages/core/src/sql/index.ts` returns no matches (not added to the public barrel)
- [ ] `.changeset/tenant-guardrail-honesty.md` exists
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `tokenizeSqlSpans` returns spans that overlap or are not in ascending offset order. The length-preserving blanking in Step 2 depends on both; report the actual behavior rather than working around it.
- Blanking quoted regions breaks an existing guardrail test. That would mean some current behavior depends on matching inside literals — worth understanding before changing.
- You find yourself wanting to make the guardrail clause-aware (checking that the identifier is in a `WHERE`, not a `SELECT` list). That is genuinely valuable and explicitly belongs to plan 050. Note the temptation in your report and move on.
- The docs contain a guarantee about `strict` mode that you cannot correct without deciding product policy — for example a claim that AskDB is sufficient for compliance. Report the exact wording and let the maintainer decide.
- `tokenizeSqlSpans` does not handle SQL comments (`--` or `/* */`). Check this in Step 2. If comments are treated as code, identifiers inside a comment still produce false positives — record it as a known remaining gap in your report and in the docstring rather than extending the tokenizer here.

## Maintenance notes

- **The known-limitation tests from Step 4 case 5 will fail when plan 050's rewriting work lands** — correctly. At that point they should be updated to assert the new, sound behavior, not deleted.
- If `tokenizeSqlSpans` ever gains comment handling, this guardrail benefits automatically because it consumes spans rather than reimplementing the scan. That is the reason for using the shared tokenizer instead of another bespoke regex.
- **The honest description is the durable part of this plan.** If a future change makes the guardrail meaningfully stronger, update the docstring and docs in the same commit — but only downgrade the "not a security boundary" language when the check actually parses the query and reasons about clause position, which the lexer alone does not provide.
- **Reviewer focus**: verify that the length-preserving blanking really preserves length (an off-by-one silently shifts every subsequent word boundary), and that case 4 exists and passes.
