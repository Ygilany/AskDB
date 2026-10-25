# Spec: apply the mysql test-campaign plan (#515)

## For the owner

This spec retires `@askdb/mysql`'s live `mysql.integration.test.ts` after moving its two unique assertions (empty `warnings`, the `org` keys) into the multi-engine fixture suite, drops the test-only `foldMysqlResult` export and two dead imports, corrects the `MYSQL_CATALOG_SQL` comment, and leaves the `mysql.lazy.test.ts:127` cwd-default case in place for the cross-dialect batch.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. `mysql.lazy.test.ts:127` cwd-default case | Leave it in place; defer the row to the cross-dialect batch that adds the kit cwd case. This PR stays mysql-only | @Ygilany, grilling (2026-10-25), Q1 | Two-way |
| 2. `MYSQL_CATALOG_SQL` | Keep the export; fix its doc comment's claim that snapshot-based tests exist | @Ygilany's `ok` to triage's D1, grilling (2026-10-25) | Two-way |
| 3. Optional `provider.test.ts:17-18` trim | Skip it | @Ygilany's `ok` to triage's D2, grilling | Two-way |
| 4. CI/fixture/docs cleanup after the retirement | Not in this PR; a separate follow-up issue | @Ygilany's `ok` to triage's D3, grilling | Two-way |

```text
packages/mysql/src
├─ exec/mysql.integration.test.ts          ✗ deleted (77 lines, MYSQL_DATABASE_URL)
├─ connector/multi-engine.integration.test.ts
│    └─ default-mode case                  + warnings == [] ; org PK/FK asserts
├─ connector/describe.ts
│    ├─ foldMysqlResult                    − export keyword
│    └─ MYSQL_CATALOG_SQL comment          ~ no "snapshot-based tests" claim
├─ connector/describe.test.ts              − 2 unused imports
└─ exec/mysql.lazy.test.ts:127             = unchanged (deferred)
.changeset/<name>.md                       + patch for @askdb/mysql
```

**Risks:** the deleted file sits under a sensitive path (`packages/*/src/exec/**`); losing it drops MySQL 8.0 coverage (EOL April 2026), which the fixture's MySQL 8.4 and MariaDB 11.4 replace. The new asserts only run with `ASKDB_FIXTURE_HOST` set, so build must say whether it ran them.

**Done when:** the default-mode multi-engine test asserts empty `warnings` and the `org` keys for `mysql` and `mariadb`; the integration file is gone; `foldMysqlResult` is unexported; `pnpm test` and `pnpm lint` pass; a `@askdb/mysql` patch changeset exists.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited `@askdb/mysql`'s tests and found that `exec/mysql.integration.test.ts` (gated on `MYSQL_DATABASE_URL`, run in CI against a `mysql:8.0` service) duplicates what `connector/multi-engine.integration.test.ts` already proves against the shared fixture on MySQL 8.4 and MariaDB 11.4. Its runner test (`SELECT 1 AS n, 'ok' AS label`) is covered by the fixture suite running the real mysql2 runner and folding every catalog query through the driver's field names. Its describe test is covered by the list-mode golden compare, except for two things the fixture suite doesn't yet assert in default (no-list) mode: that `warnings` is empty, and that primary keys and foreign keys come out right on the live default-mode path. Keeping the file costs a CI database service and a second env var for coverage the fixture mostly owns.

Separately, `foldMysqlResult` is exported from the connector's `describe` module only for a test that was removed earlier; nothing imports it now, and `describe.test.ts` still imports it and `compileTableFilters` without using either. The `MYSQL_CATALOG_SQL` doc comment says the strings are exposed "for snapshot-based tests", which don't exist; the constant is public API (re-exported from the package index and named in the CHANGELOG).

## Solution

The live MySQL coverage lives in one place, the multi-engine fixture suite. Its default-mode test gains the two assertions only the retired file had, so the retirement loses no contract. The retired file is deleted. The test-only export and the dead imports go, and the public constant's comment says what it is for. The `mysql.lazy.test.ts:127` case stays until the kit has its own cwd-default test (decision 1). The CI service, the env var and the docs rows that only the retired file used stay for now and become a follow-up issue (decision 4).

## User Stories

1. As a maintainer, I want MySQL's live introspection proven in one suite, so that a connector change has one place to break and one fixture to run.
2. As a maintainer, I want the default (no-list) mode test to assert `warnings` is empty, so that a regression that emits a warning on a clean database fails a test after the integration file is gone.
3. As a maintainer, I want the default-mode test to assert `program`'s composite primary key `[agency_id, program_code]`, so that a regression in reading composite keys from the connection's own database fails.
4. As a maintainer, I want the default-mode test to assert `program.agency_id → agency.agency_id`, so that the live default-mode foreign-key path is covered.
5. As a maintainer, I want the default-mode test to assert the self-reference `agency.parent_agency_id → agency.agency_id`, so that self-referencing keys in default mode stay covered.
6. As a maintainer, I want those assertions to run for both `mysql` and `mariadb`, so that both engines in the family keep the same contract.
7. As a contributor, I want `mysql.integration.test.ts` gone, so that I don't need a second MySQL database or `MYSQL_DATABASE_URL` to cover what the fixture covers.
8. As a contributor, I want no other file in the repo to import or name the deleted test file as a test target, so that nothing breaks or points at a missing file.
9. As a maintainer, I want `foldMysqlResult` unexported, so that the module's surface shows only what callers use.
10. As a contributor, I want `describe.test.ts` free of unused imports, so that it reads as what it tests.
11. As a host app developer, I want `MYSQL_CATALOG_SQL` still exported from `@askdb/mysql`, so that code that reads it keeps compiling.
12. As a host app developer reading `MYSQL_CATALOG_SQL`'s doc comment, I want it to describe the constant accurately, so that I'm not sent looking for snapshot tests that don't exist.
13. As a maintainer, I want the `mysql.lazy.test.ts:127` case left in place and named as deferred, so that the cwd-default contract keeps a test until the kit owns one.
14. As a maintainer, I want a patch changeset for `@askdb/mysql`, so that the release notes record the source change under `packages/mysql/src`.
15. As a maintainer, I want the infra this retirement frees (the CI `mysql:8.0` service, `MYSQL_DATABASE_URL`, `fixtures/mysql/`, the `CONTRIBUTING.md` and `docs/agents/code-review.md` rows) filed as a follow-up issue, so that it isn't lost and this PR stays small.
16. As a reviewer, I want the PR to say whether the fixture suite ran with `ASKDB_FIXTURE_HOST` set, so that I know whether the new assertions were seen passing locally or only in CI.

## Implementation Decisions

- **Carry-over into the multi-engine suite.** The default-mode test (`without a list, reads only the connection's database under public`) keeps its current table-list assertion and also:
  - asserts the introspection result's `warnings` equals `[]` (it already gets `result` from the shared introspect helper and currently discards it);
  - asserts, on the default-mode `schema.json`, that `program`'s primary-key columns are exactly `agency_id` and `program_code`, and `agency`'s is `agency_id`;
  - asserts `program` has the relationship `program.agency_id → agency.agency_id`, and `agency` has `agency.parent_agency_id → agency.agency_id`.
  The artifact's `SchemaJson` shape carries primary keys as a per-column `primaryKey` flag and relationships as `{ from, to }` column-id pairs; build asserts against that shape (or the fixture's existing comparison helper scoped to `org`, if it fits without changing the fixture package). The fixture's connection database is `org`, so these are the live default-mode PK and FK path the retired describe test covered.
- **Retirement.** `exec/mysql.integration.test.ts` is deleted whole, including its CREATE/DROP seeding hooks. No replacement file.
- **Test-only seam.** `foldMysqlResult` loses its `export` keyword and stays a module-private function. It is not re-exported from the connector index or the package index, and the package's exports map is `"."` only, so no public surface changes. `describe.test.ts` drops its unused `foldMysqlResult` and `compileTableFilters` imports.
- **`MYSQL_CATALOG_SQL` (decision 2).** The export and its value are unchanged. Only the doc comment changes: it drops "exposed for snapshot-based tests" and says what the strings are (the default, connection-database catalog SQL the connector issues), without claiming a test kind that doesn't exist.
- **`mysql.lazy.test.ts:127` (decision 1).** Unchanged. The campaign's acceptance row for it reads "left in place, deferred to the cross-dialect batch".
- **`provider.test.ts` (decision 3).** Unchanged.
- **Infra (decision 4).** `.github/workflows/ci.yml`, `turbo.json`, `fixtures/mysql/`, `CONTRIBUTING.md` and `docs/agents/code-review.md` are not edited. Build files a follow-up issue naming each of them (the issue's "Infra the retirement unlocks" list) and links it from the PR.
- **Changeset.** One patch changeset for `@askdb/mysql`, since `packages/mysql/src` changes (the dropped export and the comment). It describes the change as internal: no public API change.
- **Expected size.** About 90 changed lines in 5 files (the deleted test, the multi-engine test, `describe.test.ts`, `describe.ts`, the changeset).

## Testing Decisions

- A good test here asserts what the connector produces from a real database (the artifact's tables, keys and relationships, and the result's warnings), not how `describe` gets there. The carry-over asserts the artifact, as the existing default-mode test does.
- The seam is the existing one: `introspect()` with the real mysql2 runner against the multi-engine fixture, through the suite's shared helper. No new seam, no new test file.
- Prior art: the list-mode test in the same file (`warnings` `[]`, golden compare via `compareToLogicalSchema`) and the retired file's describe test, whose PK/FK checks the carry-over strengthens from `toContain`/`references.table` to exact keys and relationships.
- The new assertions run only when `ASKDB_FIXTURE_HOST` is set (CI sets it with `ASKDB_REQUIRE_INTEGRATION=1`, so a missing fixture fails there rather than skipping). Build runs `pnpm fixture:up` and the mysql package's tests with `ASKDB_FIXTURE_HOST` where Docker is available, and says in the PR whether it did; when it can't, CI's run is the proof.
- `pnpm test` and `pnpm lint` pass; `pnpm lint` (TypeScript noEmit) confirms nothing still imports `foldMysqlResult`. The existing `describe.test.ts` cases (all 8 kept) still pass with the export dropped, since none uses it.
- Each changed test passes the `factory-test-audit` gate.

## Ticket coverage

| Ticket "Done when" / acceptance row | Met by |
| --- | --- |
| Each `F` row repaired | None in the campaign (F 0) |
| Each `C` row consolidated into its keeper, with the carried assertions | Implementation Decisions: carry-over and retirement |
| `mysql.integration.test.ts:47` (runner returns columns and rows) | Retirement; keeper is the multi-engine suite's real-runner query and catalog fold (Problem Statement) |
| `mysql.integration.test.ts:55` (connector describes a live schema) | Carry-over: `warnings` `[]` and the `org` PK/FK assertions in default mode |
| `mysql.lazy.test.ts:127` (cwd default) | Decision 1: left in place, deferred to the cross-dialect batch; named in Out of Scope |
| Each `D` row deleted | None in the campaign (D 0) |
| Each test-only production seam removed | `foldMysqlResult` unexported, dead imports removed; `MYSQL_CATALOG_SQL` kept with a fixed comment (decision 2) |
| Triage: nothing else imports the deleted file | User story 8; `pnpm lint`/`pnpm test` |
| Triage: `MYSQL_CATALOG_SQL` still exported with an accurate comment | Decision 2 |
| `pnpm test` and `pnpm lint` pass | Testing Decisions |
| Triage: a changeset for `@askdb/mysql` | Implementation Decisions: changeset |

## Out of Scope

- **The `mysql.lazy.test.ts:127` cwd-default row (deferred, decision 1).** It retires only together with a kit `driver.test.ts` case for the omitted-`resolveFrom` → `process.cwd()` default, best done as one cross-dialect batch over the postgres, mysql, sqlite and sqlserver lazy tests, owned by the kit lane. The sibling campaign tickets (#514, #516, #517) carry the same row.
- **The infra the retirement frees (decision 4):** the CI `mysql:8.0` service and `MYSQL_DATABASE_URL` (in `ci.yml` and `turbo.json`), `fixtures/mysql/`, the `CONTRIBUTING.md` row and the `docs/agents/code-review.md` mention. Build files this as a follow-up issue; until it lands, CI still starts the `mysql:8.0` service with nothing using it.
- **The optional `provider.test.ts:17-18` trim (decision 3).**
- **Removing or renaming `MYSQL_CATALOG_SQL`:** a breaking public-API change, the maintainer's call, not raised here.
- **The campaign's two product notes:** the `DATABASE_URL` wording in the missing-connection message (`provider.ts`, shared with SQL Server) and the IPv6-bracket doc nit in `label.ts`. Neither failed; each needs reproducing and its own issue first.

## Further Notes

- The only coverage lost is MySQL 8.0 specifically, which reached end of life in April 2026; the fixture covers MySQL 8.4 and MariaDB 11.4.
- No glossary term or decision record: the grilling record lists none for this test-hygiene change.
