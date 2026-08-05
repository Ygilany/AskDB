# Plan 036: Add brand-checked error predicates so `instanceof` is never required across module boundaries

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/core/src/errors.ts packages/core/src/index.ts` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none. (An earlier version of this line claimed extra value once plan 034 landed, on the theory that dual-publishing would create duplicate ESM/CJS module instances. That is wrong on two counts: 034 no longer emits a CommonJS build, and `require()` and `import()` of the same package return the *same* namespace object — verified. The justification below stands on its own.)
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — purely additive exports.

## Why this matters

`@askdb/core` exposes an error hierarchy but no way to identify its errors except `instanceof`. `instanceof` compares class identity, which silently fails whenever two copies of `@askdb/core` end up in one process — two versions in one dependency tree, a bundled copy alongside a `node_modules` copy, or a vendored copy. (Note: a CommonJS `require()` and an ESM `import()` of the *same* package do **not** produce two copies — Node returns one namespace object either way. That specific scenario is not a motivation here.)

A real consumer hit exactly this. Because they had to load `@askdb/core` lazily, their error-classification function could not simply import the class — it takes the whole loaded module as a parameter just to reach the constructor:

```ts
  private toHttpError(core: AskDbCore, error: unknown, fallbackMessage: string): Error {
    // …
    if (error instanceof core.AskDbError) {
      return new BadRequest(error.message);
    }
```

and their unit test had to fabricate a stand-in class:

```ts
/** Stands in for AskDB's own error base class so the service's classification can be exercised. */
class FakeAskDbError extends Error {}
```

A brand-checked predicate removes both problems. It is roughly twenty lines, has no runtime cost, and turns error handling into a plain import.

## Current state

`packages/core/src/errors.ts` defines six classes. The base:

```ts
export class AskDbError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AskDbError";
  }
}
```

and five subclasses, each setting its own `name` — `SchemaParseError` (line 11), `SqlValidationError` (line 26, also carries `rule: SqlValidationRuleCode`), `SqlGenerationError` (line 38), `TenantScopeError` (line 51, carries `reason: TenantScopeRejectionReason`), `TenantGuardrailError` (line 75, carries `warnings: TenantGuardrailWarning[]`).

`packages/core/src/index.ts:1` re-exports the whole module:

```ts
export * from "./errors.js";
```

so anything added to `errors.ts` is automatically part of the public API — no index edit is needed.

There are currently no predicates. Confirm with: `grep -n "isAskDbError" packages/core/src/errors.ts` → no matches.

### Convention to match

`errors.ts` uses no imports, plain `export class` / `export type` declarations, and JSDoc block comments on non-obvious members (see the comment on `SqlValidationRuleCode` at line 18 and on `hint` at line 30). Match that style. Tests for core live beside the source as `*.test.ts` and run under vitest — see `packages/core/src/sql/validate.test.ts` for the structural pattern (`describe` / `it` / `expect`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm --filter @askdb/core build` | exit 0 |
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Tests (this file) | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/errors.test.ts` | all pass |
| Full test | `pnpm test` | all pass |

## Scope

**In scope**:
- `packages/core/src/errors.ts`
- `packages/core/src/errors.test.ts` (create)
- `.changeset/error-type-predicates.md` (create)

**Out of scope** (do NOT touch):
- Every existing `throw` site. The classes keep working exactly as they do today; this plan only adds a second way to recognize them.
- `packages/core/src/index.ts` — `export *` already covers the new symbols.
- `packages/client/src/errors.ts` — the client has its own error types with their own concerns. A follow-up can mirror this pattern there; doing it now widens the diff for no additional proof.
- Any change to error messages, `name` values, or constructor signatures — consumers match on these today.

## Git workflow

- Branch: `advisor/036-error-type-predicates`
- Commit message style e.g. `feat(core): add brand-checked error predicates`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the brand and the base predicate

At the top of `packages/core/src/errors.ts`, above `AskDbError`, add a cross-realm brand. `Symbol.for` is required — a plain `Symbol()` would create a distinct symbol per module copy and reintroduce the exact problem this plan solves.

```ts
/**
 * Cross-realm brand for AskDB errors.
 *
 * Registered via `Symbol.for` so the same key resolves across duplicate copies
 * of this module — two versions in one dependency tree, or an ESM copy loaded
 * alongside a CommonJS copy. `instanceof` compares class identity and fails in
 * those cases; a branded property does not.
 */
const ASKDB_ERROR_BRAND: unique symbol = Symbol.for("askdb.error") as never;
```

Then set the brand in `AskDbError`'s constructor and add the predicate. The brand is defined non-enumerably so it never shows up in `JSON.stringify`, structured logging, or snapshot tests:

```ts
export class AskDbError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AskDbError";
    Object.defineProperty(this, ASKDB_ERROR_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

/**
 * True for any error thrown by AskDB.
 *
 * Prefer this to `instanceof AskDbError` — it keeps working when more than one
 * copy of `@askdb/core` is loaded (two versions in one dependency tree, or a
 * bundled copy alongside one from `node_modules`), where `instanceof` silently
 * returns false.
 */
export function isAskDbError(value: unknown): value is AskDbError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[ASKDB_ERROR_BRAND] === true
  );
}
```

Because every subclass calls `super(...)`, all six classes are branded with no further changes.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Add a per-subclass predicate for each of the five subclasses

Add each predicate immediately after its class declaration, so the class and its guard stay adjacent. Each narrows on the branded base plus the `name` string that class already sets:

```ts
/** True for {@link SchemaParseError}. See {@link isAskDbError} for why this is preferred over `instanceof`. */
export function isSchemaParseError(value: unknown): value is SchemaParseError {
  return isAskDbError(value) && value.name === "SchemaParseError";
}
```

Add the equivalent for `SqlValidationError`, `SqlGenerationError`, `TenantScopeError`, and `TenantGuardrailError`, each checking its own `name` value exactly as set in that class's constructor.

**Verify**:
```
pnpm --filter @askdb/core lint
grep -c "^export function is" packages/core/src/errors.ts
```
→ exit 0, and the count is `6` (the base plus five subclasses).

### Step 3: Write the tests

Create `packages/core/src/errors.test.ts` covering:

1. `isAskDbError` is true for an instance of each of the six classes.
2. `isAskDbError` is false for `new Error("x")`, `null`, `undefined`, `"string"`, `42`, and `{}`.
3. Each subclass predicate is true for its own class and false for a sibling — e.g. `isSqlValidationError(new SqlGenerationError("x"))` is false.
4. **The cross-realm case, which is the whole point.** Simulate a duplicate module copy by building an object that carries the registered brand without sharing class identity:

```ts
  it("recognizes an error from a duplicate copy of the module", () => {
    // A second copy of @askdb/core would produce an error like this: same
    // registered brand, different class identity. `instanceof` fails here.
    const fromOtherCopy = Object.defineProperty(new Error("boom"), Symbol.for("askdb.error"), {
      value: true,
      enumerable: false,
    });
    Object.assign(fromOtherCopy, { name: "SqlValidationError" });

    expect(fromOtherCopy instanceof AskDbError).toBe(false);
    expect(isAskDbError(fromOtherCopy)).toBe(true);
    expect(isSqlValidationError(fromOtherCopy)).toBe(true);
  });
```

5. The brand is non-enumerable: `Object.keys(new AskDbError("x"))` does not contain it, and `JSON.stringify` output is unchanged.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/errors.test.ts` → all pass, at least 5 test cases.

### Step 4: Changeset and full gate

Create `.changeset/error-type-predicates.md` — **minor** bump for `@askdb/core`. Body: the new predicates are additive; recommend them over `instanceof` for consumers who load AskDB dynamically or may end up with more than one copy in the tree; note that `instanceof` continues to work unchanged.

**Verify**: `pnpm build && pnpm lint && pnpm test` → all exit 0.

## Test plan

- New file `packages/core/src/errors.test.ts`, structured after `packages/core/src/sql/validate.test.ts`.
- Cases enumerated in Step 3: positive per class, negative for non-AskDB values, sibling discrimination, the duplicate-module-copy case, and brand non-enumerability.
- Verification: `pnpm --filter @askdb/core test` → all pass including the new file; existing test count unchanged.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0; `packages/core/src/errors.test.ts` exists and passes
- [ ] `grep -c "^export function is" packages/core/src/errors.ts` returns 6
- [ ] `node -e "const {isAskDbError,SqlValidationError}=require('./packages/core/dist/index.js'); if(!isAskDbError(new SqlValidationError('x','SQL_EMPTY'))) throw new Error('predicate broken'); if(isAskDbError(new Error('y'))) throw new Error('false positive'); console.log('OK')"` prints `OK` (run after `pnpm build`; use the ESM entry if plan 034 has not landed)
- [ ] `git diff --stat` shows changes only in `packages/core/src/errors.ts`, the new test file, and the changeset
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Adding `Object.defineProperty` in the `AskDbError` constructor breaks any existing test — particularly a snapshot or deep-equality assertion on an error object. The brand is defined non-enumerable specifically to prevent this; if a test still fails, the test is inspecting the error in a way this plan did not anticipate and needs a decision.
- TypeScript rejects the `unique symbol` declaration under the repo's config. Report the exact error rather than falling back to a plain string-keyed property — the key choice is load-bearing.
- You find an existing `isAskDbError` or similar predicate already exported from `@askdb/core` (the codebase has drifted since this plan was written).

## Maintenance notes

- **Every new error class added to `errors.ts` needs its predicate in the same commit.** The `grep -c "^export function is"` count in the done criteria will need updating; treat that as the reminder.
- Subclass predicates key off the `name` string, so **renaming a class's `name` is a breaking change** to its predicate. If a rename is ever needed, update the predicate in the same change and call it out in the changeset.
- `@askdb/client` has a parallel error hierarchy in `packages/client/src/errors.ts` that would benefit from the same treatment. Deliberately deferred to keep this diff small — worth a follow-up.
- **Reviewer focus**: confirm `Symbol.for` (registered, cross-realm) was used and not `Symbol()`, and that the brand is non-enumerable.
