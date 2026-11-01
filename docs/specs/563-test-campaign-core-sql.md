# Spec: core-sql test campaign repairs (#563)

## For the owner

Three weak tests in `@askdb/core`'s SQL suites get assertions that can fail for the regression their names promise, and one duplicate test is deleted; only `sql/validate.test.ts` and `sql/bind.test.ts` change.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| None open, none defaulted | The ticket's plan names every repair, its input and its keeper; triage took no default and the grilling settled nothing new | triage record (`Settled decisions: none`, `Defaults: none`) | n/a |

| Test | Today | After |
| --- | --- | --- |
| `validate.test.ts` "runs dialect-specific extraValidate after base checks pass" | passes even if `extraValidate` ran first | also asserts a multi-statement input is rejected as `SQL_MULTI_STATEMENT`, not by the hook |
| `validate.test.ts` "rejects SQL that any built-in dialect would read as a write" | row 1 is rejected by the Postgres lexer, so the MySQL lexer in the loop is untested | row 1 is an input only the MySQL reading rejects, plus a Postgres-accepts control |
| `bind.test.ts` "throws MISSING_VALUE" | carries a no-leak assertion that cannot fail | keeps only its `reason` assertion |
| `bind.test.ts` new case in `bindPreparedQuery — errors` | (no test binds a rejected value) | binds `"colorado-secret"` to a `date` parameter: `INVALID_VALUE`, and the message does not echo the value |
| `bind.test.ts` "does not detect a quoted ':name' marker" | duplicate of the test below it | deleted; "leaves placeholder-looking text inside every quote form untouched" keeps the contract |

**Risks:** the triage record's acceptance criterion for row 1 lost the SQL's closing quote; that input is rejected as `SQL_UNTERMINATED` by every lexer and would leave the MySQL loop untested again. This spec uses the issue's input (with the closing quote), which I checked: only MySQL and the unknown-dialect path reject it.

**Done when:** each repaired assertion was seen to fail against a deliberately broken production behaviour, the duplicate is gone, `pnpm test` and `pnpm lint` pass, and no changeset or production file is in the diff.

**Needs you:** nothing open.

Reply: `/answer ok` approves the spec · `/changes <guidance>`

## Problem Statement

The weekly test campaign audited the `core-sql` tests in `@askdb/core` (SQL generation, validation, lexing, binding, parameter manifest, dialect specs) and found three tests that pass without checking what their names promise, and one test that is a strict subset of another. A maintainer reading those tests believes three contracts are guarded that are not: that a dialect's `extraValidate` runs only after the base SELECT-only checks pass, that an unknown dialect id is checked under the MySQL lexer as well as the others, and that a bind error never echoes the rejected parameter value. A regression in any of the three would ship with the suite green, and the third one is a data-leak contract (`bindPreparedQuery` error messages can reach logs and HTTP responses).

## Solution

Repair the three tests in place so each assertion fails when its contract breaks, move the no-leak check to a test that actually binds a rejected value, and delete the duplicate. No production code, public API or package output changes, so no changeset and no docs update.

## User Stories

1. As an AskDB maintainer, I want the `extraValidate` ordering test to fail if the hook ran before the base checks, so that a refactor of `validateSelectSql` cannot silently let a dialect hook see multi-statement SQL.
2. As an AskDB maintainer, I want the unknown-dialect test to fail if the MySQL lexer were dropped from the loop over `ENGINE_LEXER_PROFILES`, so that a host passing a custom dialect id still gets the conservative "any engine would read this as a write" check.
3. As an AskDB maintainer, I want a bind test that passes a rejected value and checks the error message does not contain it, so that the "never includes the raw parameter value in thrown error messages" contract on `bindPreparedQuery` is actually guarded.
4. As a host developer logging `QueryParameterError` messages, I want the no-leak contract tested, so that a user's parameter value never ends up in my logs through an AskDB error.
5. As an AskDB maintainer, I want the `MISSING_VALUE` test to assert only what it can check, so that nobody reads a vacuous no-leak assertion as coverage.
6. As an AskDB maintainer, I want the duplicate quoted-marker test removed, so that the suite has one keeper per contract and a future change to that contract touches one test.
7. As a reviewer of this PR, I want each repaired assertion shown failing against a deliberately broken production behaviour, so that I can trust the repair is not another vacuous test.
8. As the next week's test campaign, I want the keepers named in the issue's layer plan to hold after this change, so that the next audit starts from a clean ledger.

## Implementation Decisions

All five changes are in two test files of `@askdb/core`'s SQL folder; the ticket's issue body is the plan, and each item below is its row.

- **`validateSelectSql` ordering test ("runs dialect-specific extraValidate after base checks pass").** Keep its two existing assertions and add one more: `validateSelectSql` with the test's `noStarSelect` dialect on `SELECT * FROM users; SELECT 1` is rejected with rule `SQL_MULTI_STATEMENT`, through the file's existing `expectRule` helper. If `extraValidate` ran first, the hook's `SQL_FORBIDDEN_KEYWORD` would surface instead.
- **Unknown-dialect test ("rejects SQL that any built-in dialect would read as a write").** Replace row 1's SQL with the SQL text `SELECT 'a\' AS x, '; DROP TABLE t; SELECT 'b\' c'` (one backslash before each closing quote of `'a\'` and `'b\'`, and the statement ends with a closing `'` after `c`; written in a TS template literal, each backslash is doubled). Assert it is rejected for the test's `legacy` dialect through the existing `expectRejected` helper, and add the control that `validateSelectSql(POSTGRES_DIALECT, sql)` returns `sql` unchanged. The `WAITFOR` row stays as it is.
  - Checked at this head: Postgres, SQLite and SQL Server accept that input; MySQL and the `legacy` id reject it as `SQL_MULTI_STATEMENT`. Without the closing `'` after `c` (as the triage record's criterion has it), every lexer rejects it as `SQL_UNTERMINATED`, so the closing quote is required.
- **`MISSING_VALUE` test.** Keep the `QueryParameterError` instance check and the `reason` assertion; drop the `not.toMatch(/colorado|secret/i)` line, which cannot fail because no value is bound.
- **New rejected-value case in `bindPreparedQuery — errors`.** Declare one `date` parameter (cardinality `one`, source `question`) on a Postgres prepared query built with the file's `prepared` helper, bind it to `"colorado-secret"`, and assert the thrown error is a `QueryParameterError` with `reason` `INVALID_VALUE` and a message that does not match `/colorado|secret/i`. Today that call throws "Date parameter must be an ISO date string (YYYY-MM-DD)." (checked).
- **Duplicate quoted-marker test.** Delete "does not detect a quoted ':name' marker" in the `scanPlaceholders` describe. Its keeper, "leaves placeholder-looking text inside every quote form untouched", uses the same single-quoted `':a'` under the same generic lexer and asserts the names are exactly `["real"]`; the public-path proof stays in `generate.test.ts`. Nothing carries over.
- **No production change.** No test-only production seam is unlocked or removed; the lexer engine-profile exports stay exported, as the plan says.

## Testing Decisions

- A good test here asserts only the public behaviour of `validateSelectSql`, `bindPreparedQuery` and `scanPlaceholders` (the returned SQL, the error class, its `rule` or `reason`, its message), never internals.
- Each repaired or new assertion passes the factory test-audit gate: before keeping it, the builder breaks the production behaviour it guards and sees it fail, then restores the code. The breaks are:
  - ordering: run `extraValidate` before the base checks in `validateSelectSql` (the new assertion sees `SQL_FORBIDDEN_KEYWORD`);
  - lexer loop: drop the MySQL lexer from the unknown-dialect loop (row 1 is then accepted);
  - no-leak: include the raw value in the `date` coercion's error message (the new case sees `colorado-secret`).
  None of these breaks is committed.
- Modules tested: `@askdb/core`'s `sql/validate` and `sql/bind` suites only.
- Prior art: the same files' `expectRule`, `expectRejected` and `prepared` helpers, and the `INVALID_LIST_CONTEXT` case's `expect.objectContaining({ reason })` shape; #507 (PR #535) applied last week's campaign plan the same way.
- Verification: `pnpm test` and `pnpm lint` green.

## Ticket coverage

| Done when (issue's acceptance criteria and rows) | Met by |
| --- | --- |
| Each `F` row repaired so its assertion can fail for the regression it names | Implementation Decisions: ordering test, unknown-dialect test, `MISSING_VALUE` test with the new rejected-value case; Testing Decisions: the three breaks |
| `validate.test.ts:71` (F) | Implementation Decisions: ordering test |
| `validate.test.ts:274` (F) | Implementation Decisions: unknown-dialect test |
| `bind.test.ts:245` (F) | Implementation Decisions: `MISSING_VALUE` test and the new rejected-value case |
| Each `C` row consolidated into its keeper; `bind.test.ts:87` (C) | Implementation Decisions: duplicate quoted-marker test |
| Each `D` row deleted with its remaining proof passing | None in the plan (D 0) |
| Each test-only production seam removed (none if the plan says none) | Implementation Decisions: no production change |
| `pnpm test` and `pnpm lint` pass | Testing Decisions: verification |
| No changeset (triage criterion) | Solution; Out of Scope |

## Out of Scope

- The two product bugs the campaign found, filed as #577 (`isBuiltInDialectId` accepts `Object.prototype` keys) and #578 (manifest cross-validation scans with the generic lexer): no fix and no test rows for them here.
- Making the engine lexer profiles module-internal: the plan leaves their exports.
- Any change to `generate.test.ts`, `lexer.test.ts` or the other lane files.
- A changeset: AGENTS.md exempts a change confined to test files under a package's `src`.

## Further Notes

- The campaign ran at head `5d9878c4` (origin/main), the base of this branch; line numbers in the issue are at that head.
- The ticket stays in the standard lane because both files sit under `packages/core/src/sql/**`, a sensitive path, though the diff is about 25 lines.
