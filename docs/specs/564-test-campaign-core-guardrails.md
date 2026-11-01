# Spec: apply the core-guardrails test campaign's second pass (#564)

## For the owner

This spec applies the second test campaign pass over `core-guardrails` in one PR of test-only changes: one tenant-guardrail test that couldn't fail for its named regression now can, one duplicate test is deleted in favour of the table row that already proves the same thing, and one unused import goes.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Repair the `:80` test | Keep its SQL, catch the error and assert the warnings' `[rule, tableId]` pairs equal `[["MISSING_TENANT_PREDICATE", "table:public.notes"]]` | Campaign ledger (issue body), confirmed by triage | Two-way: revert the PR |
| 2. Retire the `:358` test | Delete it; its keeper is the `an ancestor two levels up` row of `accepts %s`, with no carry-over | Campaign ledger (issue body), confirmed by triage | Two-way |
| 3. Drop the unused `vi` import | Yes, in the same PR | Campaign scope (issue body), confirmed by triage's Agent Brief | Two-way |
| 4. Production code | None changed; no test-only seam to remove | Campaign layer plan, confirmed by triage | Two-way |

```text
packages/core/src/sql/tenant-guardrail.test.ts
  "rejects polymorphic table missing id column"  ── toThrow(TenantGuardrailError) ──▶  rules+tableId == [MISSING_TENANT_PREDICATE notes]   [F repaired]
  "accepts a hierarchy foreign key compared ..."  ──────────────────────────────────▶  deleted; keeper: "accepts %s" row "an ancestor two levels up"   [C retired]
packages/core/src/sql/tenant-placeholders.test.ts
  import { describe, expect, it, vi }  ─────────────────────────────────────────────▶  import { describe, expect, it }
```

**Risks:** every touched file sits under the sensitive `packages/core/src/sql/**`, so a slip that edits `tenant-guardrail.ts` would change tenant enforcement; the PR's diff must list test files only. The mutation check edits that production file on purpose and must restore it before commit.

**Done when:** the repaired test asserts the exact warning pair and goes red with the missing-id branch deleted; the duplicate is gone and its keeper passes; no `vi` import remains unused; `pnpm test` and `pnpm lint` pass with no non-test file changed.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign's second pass over the `core-guardrails` subsystem (tenant scoping and sensitive-field guardrails in `@askdb/core`) found two tests that cost upkeep without adding proof. The test `rejects polymorphic table missing id column` asserts only that `validateTenantGuardrails` throws a `TenantGuardrailError` for `SELECT * FROM notes WHERE owner_type = 'agency'`. If the guard that rejects a polymorphic table with no tenant predicate on its id column were deleted, the input would still be rejected by the paired-discriminator guard, so the test would stay green while the regression it names shipped. No other test proves that guard: every other polymorphic-table test binds `owner_id` to a placeholder. Separately, `accepts a hierarchy foreign key compared with the scope's placeholder` runs the same SQL, under the same scope, in the same warn mode, with the same expectation as a row of a later table, so a maintainer changing hierarchy acceptance edits two tests for one contract. And `tenant-placeholders.test.ts` imports `vi` without using it, a leftover from #508.

## Solution

The tenant-guardrail tests keep one proof per contract, and each proof can fail for its contract's regression. The missing-id test asserts the exact warning the guard produces, so deleting the guard turns it red. The hierarchy-acceptance contract is proven once, by the `accepts %s` table row. The unused import is removed. No guardrail behavior, export or production file changes.

## User Stories

1. As a maintainer, I want the missing-id test to fail when the guard that rejects a polymorphic table with no `owner_id` tenant predicate is deleted, so that a regression in tenant enforcement on polymorphic tables is caught.
2. As a maintainer, I want the missing-id test to assert the warning's rule and table, so that a different guard rejecting the same input can't pass for it.
3. As a maintainer, I want the missing-id test to keep its SQL, so that its contract (a discriminator present, the id predicate absent) is unchanged.
4. As a maintainer, I want the missing-id test written like its neighbour `rejects polymorphic table missing type discriminator`, so that the two mirror tests read the same.
5. As a maintainer, I want the missing-id test to fail loudly if the call stops throwing, so that a guardrail that silently passes strict mode is caught.
6. As a maintainer, I want hierarchy-foreign-key acceptance proven by one test, so that a change to it is made and reviewed in one place.
7. As a maintainer, I want the kept `an ancestor two levels up` row to stay unchanged and green, so that retiring its duplicate loses no proof.
8. As a maintainer, I want the two reject rows in the hierarchy describe kept with their shared `joined` prefix, so that the column-carrier rejection stays proven.
9. As a maintainer, I want no unused imports in the guardrail test files, so that lint and readers aren't misled about mocks in use.
10. As a reviewer, I want the PR body to record the mutation run (branch deleted, test red with `MISSING_TYPE_DISCRIMINATOR`, file restored), so that I can trust the repair without re-running it.
11. As a reviewer, I want the PR to change test files only, so that a sensitive-path PR carries no enforcement change.
12. As a reviewer, I want the PR body to name the keeper of the retired test, so that I can check no assertion was lost.
13. As a contributor, I want `pnpm test` and `pnpm lint` green after the change, so that the cleanup breaks nothing.
14. As a host app developer, I want no guardrail behavior to change, so that this cleanup needs nothing from me.

## Implementation Decisions

- **Test-only, two files (decision 4).** The change touches the tenant-guardrail tests and the tenant-placeholder tests in `@askdb/core`, and no production file. The campaign's layer plan found no test-only production seam to remove: every symbol these tests import is exported from the package index or called by production code.
- **F repaired (decision 1).** In the strict-mode describe `validateTenantGuardrails — unsafe queries (strict mode)`, the test `rejects polymorphic table missing id column` keeps its name and its SQL, `SELECT * FROM notes WHERE owner_type = 'agency'`, and its policy and `agencyScope`. It replaces `toThrow(TenantGuardrailError)` with the try/catch shape the neighbouring `rejects polymorphic table missing type discriminator` test uses: call `validateTenantGuardrails`, `expect.unreachable` if it returns, then in the catch assert the error is a `TenantGuardrailError` and that `err.warnings.map((w) => [w.rule, w.tableId])` equals `[["MISSING_TENANT_PREDICATE", "table:public.notes"]]`. The pair is asserted, not just the rule, because the table id is part of the guard's contract (the warning names the table the predicate is missing on).
- **Why it can now fail.** In `checkPolymorphicTable`, the input mentions the discriminator, so the first discriminator check passes. Today the id-predicate check finds no `owner_id` compared with a tenant placeholder, pushes `MISSING_TENANT_PREDICATE` and returns. With that branch deleted, control reaches the paired-discriminator check, which pushes `MISSING_TYPE_DISCRIMINATOR` instead; the repaired assertion rejects that. Find the branch by the `MISSING_TENANT_PREDICATE` push inside `checkPolymorphicTable`, not by line number (the ledger's `:278-284` has drifted by a few lines).
- **C retired (decision 2).** In the describe `validateTenantGuardrails — down a hierarchy, the predicate must be on a column that carries the root's IDs`, the `it("accepts a hierarchy foreign key compared with the scope's placeholder", ...)` block is deleted. Its keeper is the row `an ancestor two levels up` of `accepts %s` in the describe `... a join path accepts only the placeholders of its root and that root's ancestors`: the same SQL, the same `agencyScope`, warn mode, and an expectation of no warnings. The keeper's policy adds only an unrelated `vendors` root, which changes neither the agency's id carriers nor the clients-to-agencies ancestor chain. Its assertion on `rule tableId` strings is as strong as the retired one on rules, so nothing carries over. The describe keeps its `warnPolicy`, its `rules` helper, its `joined` prefix and its two `rejects %s compared with the scope's placeholder` rows, which still use all three.
- **Unused import removed (decision 3).** `vi` is dropped from the `vitest` import at the top of the tenant-placeholder tests; nothing else in that file changes. The test pinned for #360 stays as it is.
- **No changeset.** Only `*.test.ts` files under a package's `src` change, which AGENTS.md exempts from needing one, and CI doesn't require one.

## Testing Decisions

- **A good test here** asserts the guardrail's observable output (the thrown `TenantGuardrailError` and its `warnings`' `rule` and `tableId`) for a given SQL, policy and scope, never which internal function ran. The repaired test meets this; it does not reach into `checkPolymorphicTable`.
- **Module tested:** `validateTenantGuardrails` in `@askdb/core`, through its public signature, unchanged.
- **Prior art:** the `rejects polymorphic table missing type discriminator` test (repaired by #508) for the try/catch shape; the `a join path accepts only the placeholders of its root and that root's ancestors` describe's `flagged` helper for asserting `rule tableId` pairs.
- **Mutation check (acceptance, not committed):** delete the missing-id branch (the `MISSING_TENANT_PREDICATE` push in `checkPolymorphicTable` and the `return` after it), run `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/sql/tenant-guardrail.test.ts`, and see the repaired test fail with `MISSING_TYPE_DISCRIMINATOR` in the received pairs; then restore `tenant-guardrail.ts` (`git checkout` it) and see it pass. Record the run in the PR body. `git diff --stat` against `main` must list only the two test files.
- **Keeper check:** the `an ancestor two levels up` row still exists, unchanged, and passes.
- **Suite:** `pnpm test` and `pnpm lint` pass.

## Ticket coverage

| Ticket item (issue "Acceptance criteria" and triage's Agent Brief) | Met by |
| --- | --- |
| Each `F` row repaired: keeps its contract, its assertion can now fail for the regression it names (`tenant-guardrail.test.ts:80`) | Implementation Decisions, "F repaired" and "Why it can now fail"; decision 1 |
| Repaired test asserts `[["MISSING_TENANT_PREDICATE", "table:public.notes"]]` and fails with the missing-id branch deleted (mutation run, file restored) | Testing Decisions, "Mutation check" |
| Each `C` row consolidated into its keeper with the assertions the plan carries over (`:358`, no carry-over) | Implementation Decisions, "C retired"; decision 2 |
| The duplicate is gone and the `an ancestor two levels up` row still exists and passes | Testing Decisions, "Keeper check" |
| Each `D` row deleted with its remaining proof passing | None in this ticket (ledger has D 0) |
| Each test-only production seam the layer plan unlocks is removed | None to remove; Implementation Decisions, "Test-only, two files"; decision 4 |
| No unused `vi` import remains in `tenant-placeholders.test.ts` | Implementation Decisions, "Unused import removed"; decision 3 |
| No non-test file changes, so no changeset is needed | Implementation Decisions, "No changeset"; Testing Decisions, `git diff --stat` |
| `pnpm test` and `pnpm lint` pass | Testing Decisions, "Suite" |

## Out of Scope

- Any production code under `packages/core/src`, including `tenant-guardrail.ts` (it is edited only during the mutation check and restored).
- The tests #508 kept on purpose, including the strict-mode tests at `tenant-guardrail.test.ts:61` and `:114`: they also assert only a generic throw, but only one guard can warn on their input, so they can't pass for an unrelated reason.
- The no-dialect backslash behaviour pinned by `tenant-placeholders.test.ts:408`, tracked as open #360 (see also #371): leave that test pinned.
- The other 156 tests the campaign marked R, and the other five lane files.

## Further Notes

- Campaign head `5d9878c4`; the lane's baseline was 348/348 test cases green across its 7 files, with no baseline failures.
- This is the second campaign pass over the lane; #508 applied the first and is the prior art for the repair.
- Line numbers above are the ledger's, taken at the campaign head; find each test by its name.
