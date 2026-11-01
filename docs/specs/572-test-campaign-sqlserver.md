# Spec: apply the `sqlserver` test-campaign plan (#572)

## For the owner

This spec applies the weekly test campaign's plan to `@askdb/sqlserver`: it repairs the missing-driver test so it fails if the runner names the wrong engine, and deletes two tests whose contracts a keeper already owns. Two test files, about 30 lines, no production change, no changeset.

| Decision | Answer | Settled by | Undo |
|---|---|---|---|
| 1. Which rows change | The 3 rows in the campaign's ledger: 1 repair (F), 2 consolidations (C), no carry-over assertions | Campaign plan in the issue body, verified at triage ("No decision is open: the plan fixes every row's action") | Two-way: revert the test edits |
| 2. Missing-driver test repair | Keep the `AskDbError` name check; replace the four message regexes with equality to `missingDriverMessage({ engine: "SQL Server", packageName: "mssql" })` from `@askdb/introspect/kit` | Same (the row's **Repair**, as postgres did in #514) | Two-way |
| 3. cwd-default lazy test | Deleted; keepers are the kit's "defaults resolveFrom to process.cwd()" test and this file's `resolveFrom`-forwarding test | Same | Two-way |
| 4. Live "SELECT 1" runner test | Deleted; keeper is the live describe test in the same suite, whose setup and teardown hooks stay | Same | Two-way |
| 5. Out of this ticket | The two possible product bugs, the dead `foldSqlServerResult` export, `SQLSERVER_CATALOG_SQL`'s export and doc comment, sibling engines' copies, #295 | Same (triage's Out of scope) | Two-way |

```text
packages/sqlserver/src/exec/
├─ sqlserver.lazy.test.ts
│   ├─ "does not load `mssql` at construction time" ............ unchanged
│   ├─ "…when `mssql` is missing rejects with a helpful AskDbError"  ◀ REPAIR: message toBe missingDriverMessage(SQL Server, mssql)
│   ├─ "resolves `mssql` from the caller project cwd…" ......... ✗ delete ─▶ kit driver.test.ts "defaults resolveFrom to process.cwd()"
│   └─ "forwards resolveFrom through the load and installed wrappers…"  unchanged (keeper, engine side)
└─ sqlserver.integration.test.ts
    ├─ "runner returns columns and rows for a simple SELECT" ... ✗ delete ─▶ "connector describes a live SQL Server schema…"
    └─ "connector describes a live SQL Server schema…" ......... unchanged (keeper; beforeAll/afterAll stay)
```

**Risks:** the lazy test sits under the sensitive path `packages/*/src/exec/**`, though only its assertions change. The integration file is skipped locally without `MSSQL_DATABASE_URL`, so only CI proves it still runs.

**Done when:** the repaired test fails with the runner's `engine` temporarily set to `"Postgres"` and passes once reverted; the two retired tests are gone and their keepers pass; no production file or changeset is added; `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing. Every decision comes from the campaign plan that triage verified; no defaults were taken.

Reply: `/approve` · `/changes <guidance>`

## Problem Statement

The maintainer wants `@askdb/sqlserver`'s tests to be ones that can fail. The weekly campaign (`factory-test-audit`, campaign mode, at `5d9878c4`) marked 3 of the package's 36 test declarations:

- The missing-driver test ("invoking the runner when `mssql` is missing rejects with a helpful AskDbError") checks the message with four regexes that match only the `mssql` install hints. The kit renders those hints and already pins the whole text. None of the regexes checks the engine name, so if the runner's loader were wired with `engine: "Postgres"`, users would be told about the "Postgres catalog query runner" and the test would still pass.
- The lazy test "resolves `mssql` from the caller project cwd when the adapter import cannot see it" can only detect the kit's `process.cwd()` default, because the runner passes its options through untouched. Since #516 the kit owns that default in its own test, against a real temp project rather than this file's mocked `createRequire`.
- The live test "runner returns columns and rows for a simple SELECT" runs the same runner, against the same database, in the same CI job as the next test in its suite, which runs all six catalog queries through it and fails on a wrong column name, column order or value.

## Solution

The sqlserver suite keeps one test per contract, at the keeper the campaign's layer plan names, and the missing-driver test can fail for the regression its name promises: a wrong engine in the message. Hosts see no behaviour change; no production file and no published output changes.

## User Stories

1. As the maintainer, I want the SQL Server missing-driver test to fail when the runner's loader names another engine, so that it proves SQL Server wiring rather than replaying kit text.
2. As the maintainer, I want that test to keep asserting the error is an `AskDbError`, so that the repair doesn't lose the error-type contract.
3. As a host developer without `mssql` installed, I want the missing-driver error still to name SQL Server, the `mssql` peer and the install commands, so that it tells me what to do (unchanged behaviour, now pinned by equality).
4. As the maintainer, I want the expected message built with the kit's own `missingDriverMessage`, so that a wording change in the kit updates every engine's expectation without editing this test.
5. As the maintainer, I want the kit's message text pinned once, in the kit's `missingDriverMessage` test, so that the engine test pins only the engine wiring.
6. As the maintainer, I want the sqlserver repair to match the postgres repair in #514, so that sibling engines' lazy tests read the same way.
7. As the maintainer, I want the cwd-default lazy test deleted, so that the `process.cwd()` default is proven once, in the kit test that runs against a real project.
8. As the maintainer, I want the `resolveFrom`-forwarding lazy test kept, so that the engine's forwarding of options to the loader and its recordset-to-`{ columns, rows }` mapping stay proven.
9. As the maintainer, I want the construction-time lazy test kept, so that building a runner without `mssql` still never imports it.
10. As the maintainer, I want the live "SELECT 1" smoke test deleted, so that the live runner is proven by the describe test that already checks table names, primary keys and foreign keys through it.
11. As the maintainer, I want the integration suite's `beforeAll` and `afterAll` kept, so that the remaining live test still has its seeded tables and a clean database afterwards.
12. As the maintainer, I want the live describe test kept as the only live proof of the `is_ms_shipped` exclusion, so that #295's decision about this file isn't pre-empted.
13. As a contributor, I want the lazy file's mocks and fixture helpers left as they are where a kept test still uses them, so that the diff stays to the three rows.
14. As a reviewer, I want each deleted test's keeper named in the PR and shown passing, so that I can check no proof was lost.
15. As a reviewer, I want evidence that the repaired test fails under the wrong-engine mutation and passes once it's reverted, so that I can trust it isn't another test that can't fail.
16. As a reviewer, I want no production file and no changeset in the diff, so that I can tell at a glance the change is test-only.
17. As the maintainer, I want the two possible product bugs and the dead `foldSqlServerResult` export left out of this PR, so that each is filed and judged on its own.
18. As the maintainer of the mysql, postgres and sqlite packages, I want their cwd and regex-replay copies left to their own lanes, so that each lane's PR stays reviewable on its own.

## Implementation Decisions

- **Repair: missing-driver message (decision 2).** In the lazy test "invoking the runner when `mssql` is missing rejects with a helpful AskDbError", keep the `name === "AskDbError"` assertion and replace the `msg` variable and its four `toMatch` assertions with one assertion that the error's message equals `missingDriverMessage({ engine: "SQL Server", packageName: "mssql" })`. Import `missingDriverMessage` from `@askdb/introspect/kit`, which `@askdb/sqlserver` already depends on and its connector provider already imports from. The test name, its setup (`createTempProject`, `process.chdir`, `shouldFail`) and the runner URL stay.
- **Retire: cwd-default lazy test (decision 3).** Delete "resolves `mssql` from the caller project cwd when the adapter import cannot see it" whole. `createTempProject` and `addMssqlFixture` stay: the `resolveFrom`-forwarding test still uses both. Nothing is carried over.
- **Retire: live runner smoke test (decision 4).** Delete "runner returns columns and rows for a simple SELECT" from the SQL Server integration suite. The suite's `beforeAll` and `afterAll` stay; `createSqlServerCatalogQueryRunner` stays imported, since the describe test uses it. Nothing is carried over.
- **Not touched.** The runner's loader and every other production file; the other tests in both files; the kit's tests; `SQLSERVER_CATALOG_SQL`'s export and doc comment; `foldSqlServerResult`; the multi-engine integration suite.
- **No changeset.** The change is confined to test files under the package's `src`, which needs none (AGENTS.md, #560).

## Testing Decisions

- **What a good test is here:** it asserts the package's external behaviour (the error a host sees, what a live describe returns) at the seam it already uses, and it can fail for the regression its name names. No new seams: the repair uses the lazy file's existing `vi.mock` of `mssql`.
- **Failure evidence for the F row:** temporarily change `engine` in the runner's `missingDriverMessage` call to `"Postgres"`, run the lazy file alone (`pnpm --filter @askdb/sqlserver exec vitest run --config ../../vitest.config.ts src/exec/sqlserver.lazy.test.ts`) and see the repaired test fail; revert and see it pass. Record both runs in one line in the PR body. The mutation is never committed.
- **Keepers for the C rows:** confirm the kit's "defaults resolveFrom to process.cwd()" test, the lazy `resolveFrom`-forwarding test and the live describe test still exist and pass, and list them in the PR body. The live describe test is skipped locally without `MSSQL_DATABASE_URL`; CI's `test` job runs it with `ASKDB_REQUIRE_INTEGRATION=1`, and its pass there is the evidence.
- **Suite:** `pnpm test` and `pnpm lint` pass.
- **Prior art:** `postgres.lazy.test.ts`'s missing-driver test after #514, and the kit's `missingDriverMessage` test, which pins the text by equality.
- Gate each changed test with `factory-test-audit`.

## Ticket coverage

| Ticket criterion | Met by |
|---|---|
| Each F row repaired and able to fail for its regression | Implementation: repair (decision 2); Testing: failure evidence |
| Each C row consolidated into its named keeper, with the carry-over assertions | Implementation: both retirements (decisions 3, 4); carry-over is none, per the plan |
| Each D row deleted; its proof exists and passes | None in this plan (D 0) |
| Each test-only production seam removed | None unlocked, per the plan; nothing to do |
| `pnpm test` green and `pnpm lint` passes | Testing: suite |
| No production file changes and no changeset (test-only change under `src`; triage) | Implementation: "Not touched" and "No changeset" |
| Row `exec/sqlserver.lazy.test.ts:114` (F) | Implementation: repair |
| Row `exec/sqlserver.lazy.test.ts:130` (C) | Implementation: retire cwd-default lazy test; Testing: keepers |
| Row `exec/sqlserver.integration.test.ts:84` (C) | Implementation: retire live runner smoke test; Testing: keepers |

## Out of Scope

- The two possible product bugs in #572 (ADO.NET key normalisation skipped when a value contains `://`; `encrypt=yes` read differently by `mssql://` and `sqlserver://`): each needs its own issue.
- Un-exporting the dead `foldSqlServerResult` (a production change with a patch changeset, best filed on its own).
- Un-exporting `SQLSERVER_CATALOG_SQL` (breaking, left to the maintainer) or rewording its doc comment.
- The same cwd and regex-replay tests in the mysql, postgres and sqlite lazy suites.
- Moving the live suite onto the multi-engine fixture (#295).

## Further Notes

- The campaign sized this for the quick lane (about 30 lines, 2 files); the lazy test's sensitive path puts it on the standard lane, as it did #517.
- The ticket passed the grill stage with no grilling record, so it adds no glossary terms or decision records.
- Campaign source: #572's ledger rows and layer plan at head `5d9878c4`; triage verified each row against the code at that head, and this spec re-checked the keepers on the branch.
