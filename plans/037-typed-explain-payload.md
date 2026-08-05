# Plan 037: Give consumers a supported way to read the guardrail `explain` payload

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/core/src/ask.ts packages/core/src/sql/validate.ts packages/core/src/index.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — the `explain` field's type is unchanged; this adds a guard and documentation around it.

## Why this matters

`ask({ explain: true })` returns the list of read-only guardrails AskDB verified. That list is the auditable output of the product — it is what a host application shows a reviewer to justify running generated SQL.

`AskPipelineResult.explain` is typed `unknown`, so there is no supported way to read it. A real consumer reverse-engineered the shape and wrote a defensive parser that silently degrades to an empty list when the duck-typing misses:

```ts
  public static toGuardrails(explain: unknown): string[] {
    if (typeof explain !== `object` || explain === null || !(`checksVerified` in explain)) {
      return [];
    }
    const { checksVerified } = explain;
    return Array.isArray(checksVerified) ? checksVerified.map(String) : [];
  }
```

Silently returning `[]` means "no guardrails were verified" is indistinguishable from "we could not parse the response" — a bad failure mode for a security affordance.

The type they needed already exists and is already exported. It is simply not connected to the field.

## Current state

`SelectGuardrailExplain` is defined at `packages/core/src/sql/validate.ts:85-89`:

```ts
/** Explanation of guardrails satisfied by a string already passing {@link validateSelectSql}. */
export type SelectGuardrailExplain = {
  statementKind: "select" | "with";
  checksVerified: readonly string[];
  remediationNote: string;
};
```

and is **already exported** from the package barrel — `packages/core/src/index.ts:166` lists `type SelectGuardrailExplain` in the export block from `./sql/validate.js`.

The built-in generator is correctly typed. `packages/core/src/sql/generate.ts:52-58`:

```ts
export type GenerateSelectSqlResult = {
  sql: string;
  explain?: SelectGuardrailExplain;
  ...
};
```

The type is lost at the dialect boundary. `packages/core/src/ask.ts:45-50`:

```ts
/** Output of a dialect's generator: validated SQL plus optional dialect-specific explain metadata. */
export type AskDialectGenerateResult = {
  sql: string;
  explain?: unknown;
  ...
};
```

and again on the pipeline result, `packages/core/src/ask.ts:156-164`:

```ts
export type AskPipelineResult = {
  sql: string;
  explain?: unknown;
  ...
};
```

The widening to `unknown` is **deliberate and correct**: `AskDialect` is a documented escape hatch (`packages/core/src/ask.ts:52-60`) for fully custom generators, which may attach any explain metadata they like. Narrowing `AskPipelineResult.explain` to `SelectGuardrailExplain` outright would be wrong and would break custom dialects.

The right fix is therefore not to change the type, but to ship a supported narrowing function so consumers stop hand-rolling one.

### Convention to match

Type guards in this repo are plain exported functions named `isX`, colocated with the type they narrow — see `isBuiltInDialectId` in `packages/core/src/sql/dialect-spec.ts` and `isReasoningEffort` in `packages/ai/src/reasoning.ts`. Tests live beside the source as `*.test.ts`; `packages/core/src/sql/validate.test.ts` is the structural pattern for this area.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Tests (this area) | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/validate.test.ts` | all pass |
| Full test | `pnpm test` | all pass |
| Build | `pnpm build` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/sql/validate.ts` — add the guard
- `packages/core/src/sql/validate.test.ts` — add its tests
- `packages/core/src/ask.ts` — JSDoc only on the two `explain` fields
- `packages/core/src/index.ts` — export the new guard
- `.changeset/typed-explain-payload.md` (create)

**Out of scope** (do NOT touch):
- The declared type of `AskPipelineResult.explain` or `AskDialectGenerateResult.explain`. Both stay `unknown`. Narrowing them would break the custom-`AskDialect` escape hatch, which is a supported extension point.
- `buildSelectGuardrailExplanation` and the `checksVerified` string list at `packages/core/src/sql/validate.ts:92-108`. Consumers may already match on those exact strings; changing them is a separate, breaking decision.
- Making a generic `AskPipelineResult<TExplain>`. It was considered and rejected — it would ripple through every caller for marginal benefit.

## Git workflow

- Branch: `advisor/037-typed-explain-payload`
- Commit message style e.g. `feat(core): add isSelectGuardrailExplain guard`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the type guard

In `packages/core/src/sql/validate.ts`, directly below the `SelectGuardrailExplain` type declaration (currently ending at line 89), add:

```ts
/**
 * Narrows `AskPipelineResult.explain` to the built-in guardrail explanation.
 *
 * `explain` is typed `unknown` because a custom {@link AskDialect} may attach
 * any metadata it likes. Every dialect AskDB ships produces a
 * {@link SelectGuardrailExplain}, so hosts using a built-in dialect can rely on
 * this guard rather than duck-typing the payload:
 *
 * ```ts
 * const { sql, explain } = await ask({ question, schema, dialect: "postgres", explain: true });
 * if (isSelectGuardrailExplain(explain)) {
 *   console.log(explain.checksVerified); // readonly string[]
 * }
 * ```
 */
export function isSelectGuardrailExplain(value: unknown): value is SelectGuardrailExplain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.statementKind === "select" || candidate.statementKind === "with") &&
    Array.isArray(candidate.checksVerified) &&
    candidate.checksVerified.every((entry) => typeof entry === "string") &&
    typeof candidate.remediationNote === "string"
  );
}
```

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Export it from the package barrel

In `packages/core/src/index.ts`, the block ending at line 167 exports from `./sql/validate.js` and already includes `type SelectGuardrailExplain`. Add `isSelectGuardrailExplain` to that same block, keeping the existing ordering convention (values before types, or alphabetical — match what the block already does).

**Verify**:
```
pnpm --filter @askdb/core build
node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>{ if(typeof m.isSelectGuardrailExplain!=='function') throw new Error('not exported'); console.log('exported OK'); })"
```
→ `exported OK`.

### Step 3: Document the contract on both `explain` fields

Add JSDoc to the two `explain` declarations so the type is discoverable from an editor hover, which is where a consumer will actually look.

`packages/core/src/ask.ts:48` — inside `AskDialectGenerateResult`, replace the bare `explain?: unknown;` with:

```ts
  /**
   * Dialect-specific explain metadata. `unknown` because a custom
   * {@link AskDialect} may attach any shape. Dialects built on the centralized
   * generator produce a `SelectGuardrailExplain` — narrow it with
   * `isSelectGuardrailExplain()`.
   */
  explain?: unknown;
```

`packages/core/src/ask.ts:158` — inside `AskPipelineResult`, apply the same treatment:

```ts
  /**
   * Guardrail explanation, present only when `explain: true` was passed.
   *
   * Typed `unknown` because a custom {@link AskDialect} may return any shape.
   * With any dialect AskDB ships, narrow it with `isSelectGuardrailExplain()`
   * from `@askdb/core` to get `{ statementKind, checksVerified, remediationNote }`.
   */
  explain?: unknown;
```

Change only the comments — the field types stay `unknown`.

**Verify**:
```
pnpm --filter @askdb/core lint
grep -c "explain?: unknown;" packages/core/src/ask.ts
```
→ exit 0, and the count is still `2`.

### Step 4: Tests

Add to `packages/core/src/sql/validate.test.ts`:

1. `isSelectGuardrailExplain(buildSelectGuardrailExplanation("SELECT 1"))` is `true` — the guard accepts what the codebase actually produces. This is the most important case: it fails loudly if the two ever drift apart.
2. True for a hand-built object with `statementKind: "with"`.
3. False for each of: `undefined`, `null`, `{}`, `"string"`, `42`, `{ checksVerified: ["a"] }` (missing the other fields), `{ statementKind: "delete", checksVerified: [], remediationNote: "" }` (invalid `statementKind`), and `{ statementKind: "select", checksVerified: [1, 2], remediationNote: "" }` (non-string entries).
4. An end-to-end case: run `ask()` with `explain: true` and an injected `deps.generateText` mock returning `SELECT 1`, then assert the guard narrows the returned `explain`. Model the mock on the existing tests in `packages/core/src/ask.test.ts`, which already inject `deps.generateText`. Put this case in `ask.test.ts` rather than `validate.test.ts`.

**Verify**: `pnpm --filter @askdb/core test` → all pass, at least 4 new cases.

### Step 5: Changeset and full gate

Create `.changeset/typed-explain-payload.md` — **minor** bump for `@askdb/core`. Body: `isSelectGuardrailExplain` is now exported for narrowing `AskPipelineResult.explain`; the field's type is unchanged so nothing breaks; include the three-line usage snippet from Step 1's JSDoc.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- Extend `packages/core/src/sql/validate.test.ts` with the guard cases from Step 4 (items 1–3), following the `describe`/`it`/`expect` structure already in that file.
- Extend `packages/core/src/ask.test.ts` with the end-to-end case (item 4), reusing that file's existing `deps.generateText` mock pattern.
- The round-trip assertion (item 1) is the regression net that matters: it couples the guard to `buildSelectGuardrailExplanation`, so a future change to the explain shape cannot silently invalidate the guard.
- Verification: `pnpm --filter @askdb/core test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0 with at least 4 new test cases
- [ ] `grep -c "explain?: unknown;" packages/core/src/ask.ts` returns 2 (types unchanged)
- [ ] `grep -n "isSelectGuardrailExplain" packages/core/src/index.ts` returns a match
- [ ] After `pnpm build`: `node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>{if(typeof m.isSelectGuardrailExplain!=='function')throw 1})"` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The round-trip test (Step 4, item 1) fails — that means `buildSelectGuardrailExplanation` does not produce what `SelectGuardrailExplain` declares, which is a real pre-existing bug and needs a decision, not a loosened guard.
- You conclude `AskPipelineResult.explain` should be narrowed to `SelectGuardrailExplain` after all. That is a breaking change to the custom dialect contract and is explicitly out of scope — report the reasoning instead of making the change.
- Any existing test breaks. This plan adds only a function and comments; nothing existing should be affected.

## Maintenance notes

- **The guard and `buildSelectGuardrailExplanation` must change together.** If a field is ever added to `SelectGuardrailExplain`, decide deliberately whether the guard requires it (strict, breaks old payloads) or tolerates its absence (lenient, accepts partial data). The round-trip test will catch the omission either way.
- The `checksVerified` strings at `packages/core/src/sql/validate.ts:98-104` are effectively public API — consumers display and match on them. Treat renames as breaking.
- **Reviewer focus**: confirm the two `explain?: unknown` field types were not changed, only their comments.
