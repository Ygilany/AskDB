# Plan 038: Ship a dialect-aware row-limit helper and a documented safe-execution recipe

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cc1193a..HEAD -- packages/core/src/sql packages/core/src/index.ts docs/integration` If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `cc1193a`, 2026-08-05
- **Breaking**: No — new exports plus documentation.

## Why this matters

AskDB deliberately never executes SQL: it returns a validated statement and the host runs it. That boundary is right, but today the handoff ends there — the docs say execution is host-owned and offer nothing further.

Every host that executes AskDB output independently rediscovers the same three requirements: cap the row count, detect whether the cap truncated the result, and run inside a read-only transaction with a statement timeout. A real consumer wrote exactly that:

```ts
  public static applyRowLimit(sql: string, rowLimit: number): string {
    const statement = sql.trim().replace(/;\s*$/, ``);
    // One extra row is fetched purely to detect - and then report - truncation.
    return `SELECT * FROM (${statement}) AS askdb_result LIMIT ${Number(rowLimit) + 1}`;
  }
```

plus, in their repository layer:

```ts
      await sequelize.query(`SET TRANSACTION READ ONLY`, { transaction });
      await sequelize.query(`SET LOCAL statement_timeout = ${Number(statementTimeoutMs)}`, { transaction });
```

Two subtleties make this worth owning rather than leaving to each host: the trailing-semicolon strip (without it the subquery wrap produces a syntax error), and the fetch-one-extra-row trick for truncation detection. A third is a genuine correctness trap — **SQL Server has no `LIMIT` keyword**, so the snippet above is silently Postgres/MySQL/SQLite-only.

Note this is *not* what `bounded_results` mode covers. That mode governs the prompt trust boundary — whether result rows may be fed back to the model — not result caps.

## Current state

There is no row-limit helper in the repo: `grep -rn "applyRowLimit\|wrapWithRowLimit" packages/` → no matches.

### Why the helper must be dialect-aware

`packages/core/src/sql/dialect-spec.ts` already documents the divergence. The SQL Server brief, line 105:

```ts
    "Limit rows with `SELECT TOP (n) …` or `ORDER BY … OFFSET m ROWS FETCH NEXT n ROWS ONLY` — there is no LIMIT keyword.",
```

versus MySQL, line 63: ``"Limit rows with `LIMIT n` (or `LIMIT offset, n`)."``

`DialectSpec` (lines 23-34) is the extension point:

```ts
export type DialectSpec = {
  id: DialectId;
  displayName: string;
  /** One short paragraph injected into the NL→SQL user prompt. */
  promptBrief: string;
  /** Identifier quoting style — informational; mainly steers `promptBrief`. */
  identifierQuote: '"' | '`';
  /** Extra keywords to forbid on top of the dialect-agnostic base denylist. */
  extraForbiddenKeywords?: readonly string[];
  /** Optional engine-specific post-validator. Receives SQL already passing the base shape checks. */
  extraValidate?: (sql: string) => void;
};
```

`DialectId` (lines 15-21) is: `"postgres" | "cockroachdb" | "mysql" | "mariadb" | "sqlite" | "sqlserver"`.

The six exported specs are `POSTGRES_DIALECT`, `COCKROACHDB_DIALECT`, `MYSQL_DIALECT`, and (further down the same file) the MariaDB, SQLite, and SQL Server specs. `getDialectSpec` and `isBuiltInDialectId` are also exported from this module and re-exported by `packages/core/src/index.ts`.

### Convention to match

- New SQL utilities live in `packages/core/src/sql/` as a focused module with a colocated `*.test.ts`. See `packages/core/src/sql/validate.ts` and `validate.test.ts` for structure, JSDoc density, and test style.
- Public symbols are re-exported from `packages/core/src/index.ts` in a grouped `export { … } from "./sql/<module>.js";` block.
- Errors thrown for bad input use `SqlValidationError` from `packages/core/src/errors.ts` with a `SqlValidationRuleCode`. Note the existing codes are a closed union (`packages/core/src/errors.ts:19-24`); do not add to it in this plan — use a plain `AskDbError` for argument validation instead.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm --filter @askdb/core lint` | exit 0 |
| Tests (new file) | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/row-limit.test.ts` | all pass |
| Full test | `pnpm test` | all pass |
| Build | `pnpm build` | exit 0 |
| Docs build | `pnpm docs:build` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/sql/row-limit.ts` (create)
- `packages/core/src/sql/row-limit.test.ts` (create)
- `packages/core/src/index.ts` — export the new symbols
- `docs/integration/executing-generated-sql.md` (create)
- `docs/integration/installable-package.md` — one cross-reference link
- `.changeset/safe-execution-helpers.md` (create)

**Out of scope** (do NOT touch):
- `packages/core/src/sql/dialect-spec.ts`. It is tempting to add a `rowLimitStrategy` field to `DialectSpec`; do not. That changes a public type every integration package implements. This plan keys off `DialectId` inside the new module instead, and the maintenance notes record the refactor as a deliberate follow-up.
- Any code that executes SQL. AskDB does not open connections; this plan ships a string transform and a documented recipe, nothing more.
- `apps/studio/src/execute-registry.ts` — Studio has its own execution path. Migrating it onto the new helper is a sensible follow-up, not part of this plan.
- The `bounded_results` mode implementation in `packages/core/src/modes/`.

## Git workflow

- Branch: `advisor/038-safe-execution-helpers`
- Commit message style e.g. `feat(core): add dialect-aware wrapWithRowLimit`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the row-limit module

Create `packages/core/src/sql/row-limit.ts`.

Design contract, in full:

- `wrapWithRowLimit(sql, options)` returns `{ sql, fetchLimit, requestedLimit }`.
- `fetchLimit` is `requestedLimit + 1`. The caller fetches that many rows; if more than `requestedLimit` come back, the result was truncated. Returning it explicitly means the caller never has to re-derive the off-by-one.
- The input statement has any trailing semicolon and surrounding whitespace stripped before wrapping, otherwise the subquery is a syntax error.
- Dialect handling:
  - `postgres`, `cockroachdb`, `mysql`, `mariadb`, `sqlite` → `SELECT * FROM (<sql>) AS askdb_result LIMIT <fetchLimit>`
  - `sqlserver` → `SELECT TOP (<fetchLimit>) * FROM (<sql>) AS askdb_result` (SQL Server has no `LIMIT`; `TOP` needs no `ORDER BY`, unlike `OFFSET/FETCH`).
- `requestedLimit` must be a positive safe integer; otherwise throw `AskDbError` with a message naming the received value.
- The subquery alias is the constant `askdb_result`. Document that a host whose own query already uses that alias should not double-wrap.

```ts
import { AskDbError } from "../errors.js";
import type { DialectId } from "./dialect-spec.js";

/** Alias given to the wrapped statement. Stable — hosts may reference it in logs. */
export const ROW_LIMIT_SUBQUERY_ALIAS = "askdb_result";

export type WrapWithRowLimitOptions = {
  /** Maximum rows the caller intends to surface. Must be a positive integer. */
  limit: number;
  /** Target engine. Determines whether `LIMIT` or `TOP (n)` is emitted. */
  dialect: DialectId;
};

export type RowLimitedQuery = {
  /** The wrapped statement, without a trailing semicolon. */
  sql: string;
  /** Rows to actually fetch — always `requestedLimit + 1`, so truncation is detectable. */
  fetchLimit: number;
  /** The caller's original `limit`. */
  requestedLimit: number;
};
```

Then the function itself, plus a companion:

```ts
/**
 * Reports whether a fetched row set was truncated, and returns only the rows
 * the caller asked for.
 *
 * Pairs with {@link wrapWithRowLimit}: fetch `fetchLimit` rows, hand them here.
 */
export function applyRowLimit<T>(rows: readonly T[], limited: RowLimitedQuery): {
  rows: T[];
  truncated: boolean;
};
```

Write both with full JSDoc, matching the density in `packages/core/src/sql/validate.ts`.

**Verify**: `pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Export from the barrel

Add a grouped export block to `packages/core/src/index.ts`, placed next to the other `./sql/*` export blocks:

```ts
export {
  wrapWithRowLimit,
  applyRowLimit,
  ROW_LIMIT_SUBQUERY_ALIAS,
  type WrapWithRowLimitOptions,
  type RowLimitedQuery,
} from "./sql/row-limit.js";
```

**Verify**:
```
pnpm --filter @askdb/core build
node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>{ if(typeof m.wrapWithRowLimit!=='function') throw new Error('missing'); const r=m.wrapWithRowLimit('SELECT 1;',{limit:10,dialect:'postgres'}); console.log(JSON.stringify(r)); })"
```
→ prints `{"sql":"SELECT * FROM (SELECT 1) AS askdb_result LIMIT 11","fetchLimit":11,"requestedLimit":10}`.

### Step 3: Tests

Create `packages/core/src/sql/row-limit.test.ts`, modeled on `packages/core/src/sql/validate.test.ts`. Cover:

- Postgres wrap produces the `LIMIT n+1` form; `fetchLimit` is `limit + 1`.
- Trailing semicolon stripped: `"SELECT 1;"` and `"SELECT 1 ;  "` both wrap cleanly and the output contains no `;`.
- SQL Server produces the `SELECT TOP (n+1) *` form and contains no `LIMIT`.
- **Every `DialectId` value is handled.** Iterate the union explicitly so that adding a dialect without updating this module fails a test: `for (const id of ["postgres","cockroachdb","mysql","mariadb","sqlite","sqlserver"] as const)` — assert each returns a non-empty `sql` containing the alias.
- Invalid limits throw `AskDbError`: `0`, `-1`, `1.5`, `NaN`, `Infinity`.
- `applyRowLimit` with exactly `limit` rows → `truncated: false`, all rows returned.
- `applyRowLimit` with `limit + 1` rows → `truncated: true`, exactly `limit` rows returned.
- `applyRowLimit` with fewer than `limit` rows → `truncated: false`.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/row-limit.test.ts` → all pass, at least 8 cases.

### Step 4: Write the safe-execution recipe

Create `docs/integration/executing-generated-sql.md`. Read two existing files in `docs/integration/` first and match their heading style, code-fence conventions, and length.

The page must cover, in order:

1. **Why AskDB does not execute SQL** — one short paragraph restating the trust boundary.
2. **The three defenses**, each with a sentence on what it protects against: read-only transaction (a prompt-injected write), statement timeout (a runaway scan), row cap (an unbounded result set).
3. **A complete, runnable Postgres example** using `pg`, showing `wrapWithRowLimit` + `applyRowLimit` inside a `BEGIN … SET TRANSACTION READ ONLY … SET LOCAL statement_timeout … ROLLBACK` block. Roll back rather than commit — nothing is ever written.
4. **A per-engine notes table** for the four live engines: the read-only incantation and the timeout setting each one uses. Where you are not certain of an engine's exact syntax, say so explicitly in the page rather than guessing — a wrong `SET` statement in our docs is worse than an acknowledged gap.
5. **A note that guardrails are heuristic** — link to `isSelectGuardrailExplain` and reproduce the `remediationNote` wording from `packages/core/src/sql/validate.ts:105-107` verbatim.

Add one cross-reference link to the new page from `docs/integration/installable-package.md`, in whichever section covers running the generated SQL.

**Verify**: `pnpm docs:build` → exit 0.

### Step 5: Changeset and full gate

Create `.changeset/safe-execution-helpers.md` — **minor** bump for `@askdb/core`. Body: new `wrapWithRowLimit` / `applyRowLimit` exports, note that SQL Server emits `TOP (n)` rather than `LIMIT`, and link the new docs page.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build` → all exit 0.

## Test plan

- New file `packages/core/src/sql/row-limit.test.ts` with the cases in Step 3.
- The exhaustive `DialectId` loop is the important one — it is what stops a future seventh dialect from silently getting Postgres syntax.
- No existing test should change. If one does, treat it as a STOP condition.
- Verification: `pnpm test` → all pass with at least 8 new cases.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @askdb/core lint` exits 0
- [ ] `pnpm test` exits 0; `packages/core/src/sql/row-limit.test.ts` exists with ≥8 cases
- [ ] `pnpm docs:build` exits 0
- [ ] After `pnpm build`, this prints the Postgres form: `node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>console.log(m.wrapWithRowLimit('SELECT 1;',{limit:10,dialect:'postgres'}).sql))"` → `SELECT * FROM (SELECT 1) AS askdb_result LIMIT 11`
- [ ] And the SQL Server form contains no `LIMIT`: `node --input-type=module -e "import('./packages/core/dist/index.js').then(m=>{const s=m.wrapWithRowLimit('SELECT 1',{limit:5,dialect:'sqlserver'}).sql; if(/LIMIT/i.test(s))throw new Error(s); console.log(s)})"`
- [ ] `docs/integration/executing-generated-sql.md` exists and is linked from `installable-package.md`
- [ ] `git diff --name-only packages/core/src/sql/dialect-spec.ts` is empty (out-of-scope file untouched)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You conclude `DialectSpec` needs a new field to do this properly. It probably does eventually — but changing that public type is out of scope here. Report the case for it instead.
- You cannot establish the correct read-only / timeout syntax for one of the engines in Step 4's table from existing repo code or first-party docs. Ship the page with that engine's row marked as unverified and say so in your report. Do not invent syntax.
- Any existing test fails.
- The wrapped SQL fails `validateSelectSql` when fed back through it. It should still pass (it is a `SELECT`), and if it does not, the wrap shape is wrong. Add that as a test case once fixed.

## Maintenance notes

- **Adding a seventh `DialectId` requires updating `row-limit.ts`.** The exhaustive loop in the test suite is the tripwire. Prefer a `switch` with an exhaustiveness check (`const _never: never = id`) inside the module so the omission is a compile error, not just a test failure.
- **The deliberate follow-up**: move the row-limit strategy onto `DialectSpec` as an optional field, so third-party dialects can supply their own instead of falling into the `LIMIT` default. Deferred here because it changes a public type implemented by every integration package.
- `apps/studio/src/execute-registry.ts` executes SQL today with its own capping logic. Migrating it onto these helpers would give the new code real usage and remove a duplicate — a good follow-up.
- **Reviewer focus**: the off-by-one. `fetchLimit` must be `limit + 1` and `applyRowLimit` must return at most `limit` rows. Confirm the SQL Server branch was actually tested rather than assumed.
