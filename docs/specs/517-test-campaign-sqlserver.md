# Spec: Test campaign: sqlserver (#517)

## For the owner

This spec repairs one `@askdb/sqlserver` describe test so it proves `isEmpty` is computed after filtering, and folds four duplicate connection-string tests into the tests that already cover them. Tests only; no production file changes.

| Decision | Answer | Settled by | Undo |
|---|---|---|---|
| Which rows to change | The 5 rows in the campaign's ledger (1 repair, 4 consolidations), with the one carry-over assertion | Campaign plan in the issue body, accepted at triage | Two-way: revert the test edits |
| How to repair the isEmpty test | Feed catalog rows that filtering removes entirely (a `sys` table, or a `dbo` table plus a `tables` filter that matches nothing); don't just rename it | default D1 | Two-way: revert the test edit |
| Seam cleanup (`foldSqlServerResult`, `SQLSERVER_CATALOG_SQL`) | Left as they are; no production change and no changeset | default D2 | Two-way: a follow-up can do it |

```
packages/sqlserver/src/
├─ connector/describe.test.ts
│   └─ "marks isEmpty when nothing usable remains after filtering"  ◀ REPAIR: input is now filtered away
└─ exec/sqlserver.url.test.ts
    ├─ "normalises 'Trust Server Certificate'…"        ✗ delete ─┐
    ├─ "normalises 'Application Intent'…"              ✗ delete ─┼─▶ "handles the full VS Code mssql-style ADO.NET string"  ◀ + not.toMatch(/Trust Server Certificate/i)
    ├─ "parses trustServerCertificate (case-insensitive key)" ✗ delete ─▶ compat row "sqlserver://db:1433;…;trustServerCertificate=true;"
    └─ "handles sqlserver:// URL without port"         ✗ delete ─▶ compat row "sqlserver://db.example.com;database=AppCatalog;…"
```

**Risks.** The ticket touches an `exec/` test file, which is a sensitive path; the change is test-only, so the exposure is losing coverage, not changing behaviour. Every deleted assertion is named in a keeper below.

**Done when.** The isEmpty test fails if `isEmpty` is computed from raw rows (checked by a temporary mutation, then reverted); the four duplicates are gone and the keepers pass; `pnpm test` and `pnpm lint` pass with no production file changed.

**Needs you.** Nothing open. Veto D1 or D2 by name if you want them otherwise.

Reply: `/approve` · `/changes <guidance>` (e.g. `/changes D1: rename instead`)

## Problem Statement

The weekly test campaign audited `@askdb/sqlserver`'s tests. Two problems stand out to a maintainer relying on them:

- The describe test named "marks isEmpty when nothing usable remains after filtering" runs with an empty catalog and no filters. Nothing is ever filtered, so the test would still pass if `describeSqlServer` computed `isEmpty` from the raw table rows instead of the filtered result. No other test proves the after-filter case: the introspect-level test stubs `isEmpty` rather than computing it.
- Four connection-string tests repeat assertions that other tests already make on the same or a superset input. They add run time and maintenance cost and no protection.

## Solution

Repair the isEmpty test so its input contains catalog rows that are all filtered away, keeping its three assertions; it then fails for the regression its name describes. Delete the four duplicate tests, and move the one assertion they hold that no keeper makes (`Trust Server Certificate` with spaces is absent from the output) into the ADO.NET keeper. Production code, exports and changesets stay untouched.

## User Stories

1. As an AskDB maintainer, I want the sqlserver isEmpty test to fail when `isEmpty` ignores filtering, so that a regression in the fold's empty-result logic is caught before release.
2. As an AskDB maintainer, I want the isEmpty test to keep asserting `isEmpty === true`, an empty `schemas` list and `provider === "sqlserver"`, so that its existing contract stays pinned.
3. As an AskDB maintainer, I want the isEmpty test's name to describe what its input exercises, so that the next campaign doesn't flag it again.
4. As an AskDB maintainer, I want a filter that removes everything to keep reporting its `ambiguous_filter` warning in the test that uses it, so that the repair doesn't hide a warning the fold emits.
5. As an AskDB maintainer, I want the ADO.NET normalisation of `Trust Server Certificate` proven once, in the full VS Code string test, so that the contract has one owner.
6. As an AskDB maintainer, I want that keeper to assert the spaced key no longer appears in the output, so that deleting the narrow test loses no assertion.
7. As an AskDB maintainer, I want the `Application Intent` normalisation proven by the same keeper, which already asserts `ApplicationIntent=ReadWrite`, so that the duplicate can go with nothing carried over.
8. As an AskDB maintainer, I want the Prisma-style `trustServerCertificate` key's case-insensitivity proven by the backward-compatibility row with the same key, whose full equality check already pins `options.trustServerCertificate`, so that a one-field test isn't needed.
9. As an AskDB maintainer, I want the portless `sqlserver://` form proven by the backward-compatibility row with the identical input, so that the subset test can go.
10. As an AskDB maintainer, I want the suite green under `pnpm test` and `pnpm lint` after the edits, so that the campaign leaves no regression behind.
11. As a reviewer, I want no production file, export or changeset in the diff, so that a test-hygiene PR can be reviewed as one.
12. As a reviewer, I want each deleted test traceable to its keeper, so that I can check coverage was preserved without re-running the audit.

## Implementation Decisions

- **Scope is the campaign's ledger rows.** One `F` row (the isEmpty describe test) and four `C` rows (the connection-string tests) in `@askdb/sqlserver`; there are no `D` rows and the layer plan unlocks no test-only seam. Settled by the campaign plan in the issue body, accepted as written at triage.
- **Repair route (default D1).** The isEmpty test feeds `describeSqlServer` catalog rows that the fold discards entirely, through the existing fake catalog runner. Either input meets D1:
  - one table (with a column row) in the `sys` schema, which the fold's default system-schema exclusion drops; or
  - one `dbo` table (with a column row) plus a `tables` filter that matches nothing (`dbo.none`). With this variant, the test also asserts the single `ambiguous_filter` warning for that filter, since the fold emits one for a filter that matches nothing.
  The test keeps its three assertions. Renaming the test instead (the mysql/sqlite wording, "when no tables or views are present") is not the route: it leaves the after-filter computation unproven.
- **Mutation check.** The builder confirms the repaired test fails when the fold's `isEmpty` is computed from the raw table rows rather than the filtered namespaces, by mutating the production line temporarily and reverting it before committing. The mutation is never committed.
- **Consolidations.**

  | Deleted test | Keeper | Carried over |
  |---|---|---|
  | "normalises 'Trust Server Certificate' to 'TrustServerCertificate'" | "handles the full VS Code mssql-style ADO.NET string" | `expect(result).not.toMatch(/Trust Server Certificate/i)` |
  | "normalises 'Application Intent' to 'ApplicationIntent'" | the same VS Code string test (already asserts `ApplicationIntent=ReadWrite`) | nothing |
  | "parses trustServerCertificate (case-insensitive key)" | backward-compatibility row `sqlserver://db:1433;database=app;user=sa;password=S3cret;trustServerCertificate=true;` | nothing |
  | "handles sqlserver:// URL without port" | backward-compatibility row `sqlserver://db.example.com;database=AppCatalog;user=appuser;password=Str0ngP4ss` (identical input) | nothing |

  The keepers stay as they are apart from the one added assertion.
- **No production change (default D2).** `foldSqlServerResult` keeps its `export` and `SQLSERVER_CATALOG_SQL` stays public. No changeset, since no publishable package's output changes.

## Testing Decisions

- A good test here asserts what `describeSqlServer` and `resolveConnectionInput` return for a given input, not how they compute it. The repaired test drives the public `describeSqlServer` entry point with a fake catalog runner and checks the returned result; it does not reach into the fold.
- Modules tested: `@askdb/sqlserver`'s connector describe tests and its exec connection-string tests. No new test file and no new seam: the existing fake catalog runner is the seam.
- Prior art: the neighbouring "filters tables with glob patterns and emits ambiguous_filter warning for misses" test (filter plus warning assertion) and the system-schema exclusion test (a `sys` row that the fold drops) in the same file show both D1 inputs.
- Validation: the two files run with the package's vitest config, then `pnpm test` and `pnpm lint` from the root. The live-database suites stay skipped unless their env vars are set; they aren't touched.
- Each test change passes the `factory-test-audit` authoring gate.

## Ticket Coverage

| Done when (issue acceptance criteria and triage brief) | Met by |
|---|---|
| Each `F` row repaired: keeps its contract and can now fail for its regression | Implementation Decisions: Repair route (D1), Mutation check |
| `describe.test.ts` isEmpty input is filtered away entirely; asserts `isEmpty`, `schemas` `[]`, `provider` | Implementation Decisions: Repair route (D1) |
| The test fails when `isEmpty` is computed from raw table rows | Implementation Decisions: Mutation check |
| Each `C` row consolidated into its named keeper with the carried-over assertions | Implementation Decisions: Consolidations table |
| The four named `url.test.ts` tests are deleted | Implementation Decisions: Consolidations table |
| ADO.NET keeper carries `not.toMatch(/Trust Server Certificate/i)`; the two `sqlserver://` compat rows still exist and pass | Implementation Decisions: Consolidations table |
| Each `D` row deleted with its remaining proof passing | None in the ledger (D 0); nothing to do |
| Each test-only seam the plan unlocks is removed | The plan unlocks none; Implementation Decisions: No production change (D2) |
| `pnpm test` and `pnpm lint` pass; no production file changes | Testing Decisions: Validation; No production change (D2) |

## Out of Scope

- Dropping the `export` on `foldSqlServerResult`, or removing `SQLSERVER_CATALOG_SQL` from the public index, and any changeset for either (D2). The second is a cross-engine maintainer call (mysql and sqlite have the same pattern); the first could be its own small follow-up.
- The two possible product bugs the campaign noted: ADO.NET normalisation skipped when any value contains `://`, and the `encrypt=` value handling differing between `mssql://` and `sqlserver://`. Each needs reproducing and its own issue.
- Trimming Studio's per-engine label replay and merging the four engines' lazy-loading suites into one parameterised suite.

## Further Notes

- Triage left no open decisions and the grill stage left no grilling record, so this spec adds no glossary terms or decision records.
- Campaign head: `2ff9332c` (green baseline, 38/38 turbo tasks). The plan estimates about 40–50 changed lines across the two test files.
