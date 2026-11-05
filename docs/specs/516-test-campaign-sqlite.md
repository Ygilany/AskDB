# Spec: apply the sqlite test-campaign plan (#516)

## For the owner

This spec applies the sqlite test-campaign plan: it repairs one unique-classification test that could not fail, moves the cwd-default proof into the introspect kit, retires two duplicate tests, and un-exports `foldSqliteResult`. It touches 5 files, about 66 lines, and adds no changeset.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Unique-classification repair | Make the explicit index in the "classifies UNIQUE constraints" test a `CREATE UNIQUE INDEX` on a column that has no `UNIQUE` constraint; assert it is in `indexes` with `unique: true` and that `uniqueConstraints` is still only `[["email"]]` | Campaign plan in the issue body, verified at triage (Settled decisions: "the issue's plan fixes each choice") | Two-way: revert |
| 2. cwd-default proof | Add one case to the introspect kit's optional-driver loader tests ("defaults resolveFrom to process.cwd()"), then delete the sqlite lazy suite's cwd-fallback test | Same | Two-way |
| 3. #447 duplicate | Delete the #447 test from the sqlite exec integration suite, with the three imports only it used; the keepers are the multi-engine integration test and core's `ask()` #447 tests | Same | Two-way |
| 4. `foldSqliteResult` | No longer exported (it has no caller outside its module and is not on the public entry) | Same | Two-way |
| 5. Out of this ticket | `SQLITE_CATALOG_SQL` stays public; the postgres, mysql and sqlserver cwd copies stay; no changeset | Same (triage's Out of scope) | Two-way |

```text
packages/sqlite
  connector/describe.integration.test.ts   [repair]  CREATE INDEX -> CREATE UNIQUE INDEX, assert unique:true, not a constraint
  connector/describe.ts                    [seam]    foldSqliteResult: export removed
  exec/sqlite.integration.test.ts          [retire]  #447 test + ask / loadSchemaFromJson / toV2SchemaJson imports
  exec/sqlite.lazy.test.ts                 [retire]  cwd-fallback test (tests 1, 2, 4 stay)
packages/introspect
  kit/driver.test.ts                       [add]     "defaults resolveFrom to process.cwd()"  ← lands before the lazy delete
```

**Risks:** the new kit case calls `process.chdir`, so it must restore cwd after each test or it leaks into later tests in the file. Until the sibling lanes act, the postgres, mysql and sqlserver lazy suites still duplicate the cwd proof.

**Done when:** the mutation that drops `il.origin === "u"` from the fold fails the repaired test; the kit cwd case passes; the two retired tests and their unused imports are gone while their keepers pass; `foldSqliteResult` has no `export`; `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited the `sqlite` subsystem's 27 test declarations and marked 24 right, 1 fragile and 2 consolidatable. The fragile test, "classifies UNIQUE constraints (origin 'u') vs CREATE INDEX (origin 'c')", only creates a non-unique `CREATE INDEX`. The fold's `is_unique === 1` check alone keeps that index out of `uniqueConstraints`, so dropping the `il.origin === "u"` half of the condition leaves every sqlite test green: the regression the test is named for goes unseen. Two other tests re-prove something already owned elsewhere. The #447 prompt-listed-name test in the exec integration suite repeats the multi-engine integration test and core's `ask()` #447 tests with an inline copy of the prompt-copying stand-in model. The lazy suite's cwd-fallback test is one of four dialect copies that are the only proof of the kit's `process.cwd()` default, and the kit itself has no test for it. Finally, `foldSqliteResult` is exported from its module with no caller outside it.

## Solution

Contributors get a sqlite suite in which each contract has one keeper that can fail. The unique-classification test builds a unique index that is not a `UNIQUE` constraint, so it fails when origin classification breaks. The cwd default is proved once, in the introspect kit that owns it, and the sqlite copy is retired after that proof exists. The #447 duplicate is retired in favour of its keepers. `foldSqliteResult` becomes module-internal. Nothing published changes: no public API, no package output, no changeset.

## User Stories

1. As a contributor changing the sqlite fold, I want the unique-classification test to fail when I break the origin check, so that I can't silently merge a constraint/index mix-up.
2. As a contributor, I want the test to build a unique index on a column with no `UNIQUE` constraint, so that the `origin` check is the only thing keeping it out of `uniqueConstraints`.
3. As a contributor, I want the test to assert that the unique index appears in `indexes` with `unique: true`, so that the index is still described, just not as a constraint.
4. As a contributor, I want the test to assert `uniqueConstraints` is exactly `[["email"]]`, so that the column-level `UNIQUE` constraint is still classified as one.
5. As a contributor, I want the test's name to say it contrasts a `UNIQUE` constraint with a `CREATE UNIQUE INDEX`, so that its name matches what it builds.
6. As a maintainer of `@askdb/introspect`, I want the optional-driver loader's own tests to prove that `load()` with no options resolves from `process.cwd()`, so that the kit's default has a keeper in the kit.
7. As a maintainer, I want that kit case to restore the working directory after each test, so that no other test in the file runs from the temp project.
8. As a maintainer, I want the kit case to land before (or with) the sqlite copy's deletion, so that the cwd default is never left without a test.
9. As a sqlite contributor, I want the lazy suite's remaining tests (no driver load at construction, the helpful `AskDbError` when the peer is missing, and `resolveFrom` forwarding through the wrappers and runner) to stay, so that sqlite's own pass-through stays proven.
10. As a contributor, I want the #447 test gone from the exec integration suite, so that the prompt-listed-name scenario has one SQLite execution keeper (the multi-engine integration test) and one prompt-text keeper (core's `ask()` tests).
11. As a contributor, I want the imports only that test used (`ask`, `loadSchemaFromJson`, `toV2SchemaJson`) removed with it, so that the exec suite doesn't pull in `@askdb/core` for nothing.
12. As a maintainer, I want `foldSqliteResult` un-exported, so that no one starts depending on an internal fold that isn't part of the package's public entry.
13. As a maintainer, I want `SQLITE_CATALOG_SQL` left as it is, so that a public-API removal across three packages gets its own decision.
14. As a reviewer, I want the PR body to show the mutation result before and after, so that I can check the repair without re-running it.
15. As the owners of the postgres, mysql and sqlserver campaigns, I want their cwd copies left alone here, so that each lane decides its own retirement once the kit case exists.

## Implementation Decisions

- **Repair (decision 1).** In the sqlite real-PRAGMA suite (`describeSqlite` against a live in-memory database), the unique-classification test's `people` table keeps its column-level `email TEXT UNIQUE`, and its explicit index on `city` becomes a `CREATE UNIQUE INDEX` (the plan allows either changing that index or adding a second one). The test asserts that `uniqueConstraints`' columns equal `[["email"]]` and that the `city` index is in `indexes` with `unique: true`. The test is renamed to contrast a `UNIQUE` constraint (origin `u`) with a `CREATE UNIQUE INDEX` (origin `c`).
- **Kit cwd case (decision 2).** `createOptionalDriverLoader` tests in `@askdb/introspect` gain "defaults resolveFrom to process.cwd()". The case makes a temp project that holds the fake driver package (the file's existing temp-project helper, with the driver), changes into it with `process.chdir`, builds a loader whose engine import fails with module-not-found, calls `load()` with no options, and expects the project's module. The file's `afterEach` restores the working directory captured when the module loads, before it removes the temp directories. The loader's behaviour does not change.
- **Lazy retirement (decision 2).** Once the kit case exists, the sqlite lazy suite drops "resolves `better-sqlite3` from the caller project cwd when the adapter import cannot see it". Its other three tests stay unchanged.
- **#447 retirement (decision 3).** The sqlite exec integration suite drops "a table named the way ask()'s prompt lists it runs on SQLite (#447)" and the `@askdb/core` (`ask`, `loadSchemaFromJson`) and `@askdb/introspect` (`toV2SchemaJson`) imports only it used. Its first two tests (the production runner and the connector on a real file) stay.
- **Un-export (decision 4).** `foldSqliteResult` loses its `export`. Nothing outside its module references it, and the package's public entry does not re-export it, so this is not a public-API change.
- **No changeset (decision 5).** The diff is test files plus one internal un-export, so no published package's API or output changes.

## Testing Decisions

- A good test here proves external behaviour through the highest seam that owns the contract: the sqlite connector's `describe` output on a real database for classification, and the kit loader's `load()` for resolution. Neither test reaches into internals.
- The repaired test's acceptance evidence is a mutation check: remove `&& il.origin === "u"` from the fold's unique-constraint condition, see the repaired test fail, then restore the code and see it pass. The PR body records both results.
- Retirement is checked by keeper, not by count. The multi-engine integration test (`askCopyingListedTableNames` executed on SQLite; needs `ASKDB_FIXTURE_HOST`) and core's `ask()` #447 describe (runs locally) still exist and pass. The kit cwd case passes, and the lazy suite's three remaining tests pass.
- Modules tested: `@askdb/sqlite` (connector real-PRAGMA suite, exec integration and lazy suites) and `@askdb/introspect` (kit optional-driver loader).
- Prior art: the kit loader test "falls back to resolveFrom when the engine import cannot see the peer" for the new case's shape; the same file's temp-project helper and `afterEach` cleanup.
- Validation commands: `pnpm test` and `pnpm lint` at the root, plus the per-file runs the issue's ledger names (`pnpm --filter @askdb/sqlite exec vitest run --config ../../vitest.config.ts <file>`, and core `src/ask.test.ts -t "#447"`).

## Ticket coverage

| Ticket item ("Acceptance criteria" in the issue and triage) | Met by |
| --- | --- |
| Each F row is repaired: keeps its contract, and its assertion can now fail for the regression it names | Decision 1; Implementation "Repair"; Testing "mutation check" |
| Each C row is consolidated into its named keeper, with the assertions the plan carries over | Decisions 2 and 3; Implementation "Kit cwd case", "Lazy retirement", "#447 retirement" |
| Kit cwd-default case passes and lands before the sqlite lazy cwd test is deleted (triage) | Decision 2; Implementation "Kit cwd case"; user story 8 |
| #447 test and its unused imports gone; keepers still exist and pass (triage) | Decision 3; Testing "Retirement is checked by keeper" |
| Lazy cwd-fallback test gone; lazy tests 1, 2 and 4 still pass (triage) | Implementation "Lazy retirement" |
| Each D row deleted (none in this plan) | Not applicable: the campaign marked D 0 |
| Each test-only production seam the layer plan unlocks is removed | Decision 4 (`foldSqliteResult`); decision 5 records `SQLITE_CATALOG_SQL` as not unlocked |
| `foldSqliteResult` has no `export`, and nothing outside its module referenced it (triage) | Decision 4 |
| Subsystem tests green with `pnpm test`, and `pnpm lint` passes | Testing "Validation commands" |

## Out of Scope

- Retiring the cwd copies in the postgres, mysql and sqlserver lazy suites. The kit case makes them consolidatable, but they belong to their own campaign lanes, and adding them would take this diff to 8 files.
- Removing `SQLITE_CATALOG_SQL` (or `MYSQL_CATALOG_SQL`, `SQLSERVER_CATALOG_SQL`) from the public entries. That is a breaking change across three packages and a separate maintainer decision.
- A kit default for the identical `fromExportUnsupported` text the three live engines pass. It is a production simplification, not a test change.
- The two possible product bugs the campaign noted: `:memory:` with the runner's `readonly` open, together with open errors that escape the `AskDbError` wrapping; and `file:` URIs, which the README documents but the bundled better-sqlite3 cannot open. Each is filed as its own issue or `discrepancy` if it reproduces.
- A changeset.

## Further Notes

- The quick lane already built this plan: commit `3a07404e` on this branch, draft PR #523. Its diff (21 insertions, 45 deletions, 5 files) matches decisions 1 to 4 and the PR body records the mutation result. The quick lane's tripwire then moved the ticket to standard because the diff touches `packages/*/src/exec/**`, a sensitive path in the project manifest, not because of its size. The grill stage was skipped with no open decisions. Build should check the existing commit against this spec and add to it only what the spec finds missing, rather than redo it.
- No glossary terms or decision records come out of this ticket. It had no grilling, and the plan introduces no new domain language.
