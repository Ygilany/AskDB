# Spec: pin the Postgres catalog runner's `BEGIN READ ONLY` / `COMMIT` / `ROLLBACK` contract (#549)

## For the owner

This spec adds a test that records every statement the built-in Postgres catalog query runner sends, and asserts the exact order on success (`BEGIN READ ONLY`, the query, `COMMIT`) and on a failing query (`BEGIN READ ONLY`, the query, `ROLLBACK`, then an `AskDbError`), so dropping `READ ONLY` or the failure-path `ROLLBACK` fails a test. Test-only: no production code, and an empty changeset (the repo's changeset check requires one even for test-only changes).

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Where the test lives | In the existing `pg`-mocking lazy-load test beside the runner, not a new file | Issue body's suggested shape, taken by triage (Agent Brief, Key interfaces) | Two-way: revert the PR |
| 2. What it asserts | Exact statement lists: success `["BEGIN READ ONLY", sql, "COMMIT"]`; failure `["BEGIN READ ONLY", sql, "ROLLBACK"]` plus rejection with an `AskDbError` naming the underlying failure | Triage, acceptance criteria | Two-way |
| 3. What stays out | No change to `postgres.ts` or other production code, other engines' runners, the Studio test or the integration test; the changeset is empty (no package bump) | Triage, Out of scope | Two-way |

```text
runner(sql) ──▶ fake pg client  [changed: records each statement]
                 success: BEGIN READ ONLY ─▶ sql ─▶ COMMIT
                 failure: BEGIN READ ONLY ─▶ sql ✗ ─▶ ROLLBACK ─▶ rejects AskDbError
```

**Risks:** the recorder must sit where the runner's `pg` import actually resolves, or the test records nothing and asserts against an empty list; the exact-list assertion catches that, since an empty list never equals the expected one.

**Done when:** both cases pass; temporarily removing `READ ONLY` from the `BEGIN` fails a test, and so does removing the failure-path `ROLLBACK`; the four existing lazy-load tests pass unchanged.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

`createPostgresCatalogQueryRunner` is the read-only guard on AskDB's live Postgres introspection path: every catalog query runs on a fresh connection inside `BEGIN READ ONLY`, is committed on success, and is rolled back before the runner rejects on failure. No test checks the statements the runner sends. The lazy-load test's fake `Pool` returns canned rows whatever it is sent, and the integration test needs a live database and doesn't record statements. A change that drops `READ ONLY`, skips the `ROLLBACK`, or commits a failed transaction passes every current test. The postgres test campaign (#514) found the gap.

## Solution

The lazy-load test's fake `pg` client gains a statement recorder and a switch that makes the catalog query throw. Two new cases call the runner through its public factory and assert the full, ordered list of statements the client received: on success `BEGIN READ ONLY`, the catalog SQL, `COMMIT`; on a failing query `BEGIN READ ONLY`, the catalog SQL, `ROLLBACK`, with the runner rejecting with an `AskDbError` whose message names the underlying failure. Because each assertion is an exact list, it also proves the absence of `ROLLBACK` on success and of `COMMIT` on failure. The runner's behavior doesn't change.

## User Stories

1. As an AskDB maintainer, I want a test to fail when `READ ONLY` is removed from the catalog runner's `BEGIN`, so that the read-only guard on introspection can't silently regress.
2. As an AskDB maintainer, I want a test to fail when the catalog runner stops issuing `ROLLBACK` after a failed query, so that a failed catalog transaction is never left open or committed.
3. As an AskDB maintainer, I want the success path pinned to `BEGIN READ ONLY`, the query, `COMMIT`, so that an added or reordered statement shows up in review as a test change.
4. As an AskDB maintainer, I want the failure path pinned to send no `COMMIT`, so that a failed query can't be committed.
5. As an AskDB maintainer, I want the failure test to check that the runner rejects with an `AskDbError` naming the driver's message, so that callers keep getting AskDB's error type with the cause visible.
6. As a host app developer using live Postgres introspection, I want the read-only transaction contract tested, so that I can trust introspection never writes to my database.
7. As an AskDB contributor changing the runner, I want the new test beside the existing lazy-load tests and in the same style, so that I find it where I expect it.
8. As an AskDB contributor, I want the existing lazy-load tests left unchanged and passing, so that the new cases add coverage without moving the old.
9. As a reviewer, I want the test to drive the runner through its public factory, not its private helper, so that it keeps passing through refactors that keep the contract.

## Implementation Decisions

- **Module under test:** the `CatalogQueryRunner` returned by `createPostgresCatalogQueryRunner(connectionString, options?)` in `@askdb/postgres`. Its contract: it loads `pg` lazily, opens one pooled client, sends `BEGIN READ ONLY`, the catalog SQL, then `COMMIT`; on any error it sends `ROLLBACK` (an error from the rollback itself is swallowed), rethrows an `AskDbError` as is, and wraps anything else as `AskDbError("PostgreSQL catalog query failed: <message>")` with the original as cause. Production code is not modified.
- **Test home:** the existing lazy-load test file beside the runner, which already mocks `pg` and `node:module` and already has a fake `Pool` whose client answers `query()` with canned rows (decision 1).
- **Recorder:** the fake client's `query()` records the statement text it receives (its first argument) into state the test can read, in arrival order, and is reset before each case. The test reads the list after the runner settles.
- **Failure switch:** the fake client throws a plain `Error` (a message the test can match) when it receives the catalog SQL and the failure switch is on; `BEGIN READ ONLY`, `COMMIT` and `ROLLBACK` still succeed. A plain `Error`, not an `AskDbError`, so the test also covers the wrapping branch.
- **Which `pg` the runner reaches:** the existing tests reach a fake `pg` in two ways: the hoisted `vi.mock("pg")` factory (today it returns the real `pg`, or throws a module-not-found error when `shouldFail` is set), and the per-test temp-project fixture that the loader falls back to through the mocked `createRequire`. The triage brief leaves the choice to build ("check which path the new test goes through"); either works if the recorder sees the runner's statements. Guidance: the recorder needs state shared with the test file, which the hoisted `pgState` gives directly; a fixture written as a CommonJS file in a temp directory would have to report through a global. Whichever path build takes, the existing four tests must keep the `pg` they get today.
- **Statement order is the contract:** assertions compare the whole recorded list with `toEqual`, never `toContain`, so a missing, extra or reordered statement fails.

## Testing Decisions

- **What a good test is here:** it drives the runner only through its public factory and observes only what reaches the `pg` client (the statements) and what the caller gets (the result or the rejection). It does not spy on the runner's internals or its private helper.
- **Cases:**
  - Success: the recorded list equals `["BEGIN READ ONLY", <sql>, "COMMIT"]`, and the runner resolves with the fake's rows mapped to `{ columns, rows }`.
  - Failure: the recorded list equals `["BEGIN READ ONLY", <sql>, "ROLLBACK"]`, and the runner rejects with an error whose `name` is `AskDbError` and whose message contains the fake's error message. The existing tests check `name`, not `instanceof`, because `vi.resetModules()` runs before each case and a class imported at the top of the file can differ from the one the runner throws; follow that, or import `AskDbError` after the reset.
- **Mutation check (done by hand during build, not committed):** remove `READ ONLY` from the runner's `BEGIN` and confirm a new case fails; restore; remove the failure-path `ROLLBACK` and confirm a new case fails; restore. Report both in the PR body.
- **Unchanged:** the four existing lazy-load cases pass as they are.
- **Prior art:** Studio's execute-registry unified test captures every `pg` query into a shared list and asserts the exact order (`BEGIN READ ONLY` … `ROLLBACK`); follow its shape. The lazy-load test's `pgState` (hoisted with `vi.hoisted`) is the existing pattern for state shared with a `vi.mock` factory.
- **Gate:** each new test passes the `factory-test-audit` authoring gate.

## Out of Scope

- Any change to `postgres.ts` or other production code.
- Statement-recording tests for the MySQL, SQL Server or SQLite runners.
- Changes to Studio's execute-registry test or the Postgres integration test.
- Asserting the parameterized branch (`query(sql, params)`) or that the client is released and the pool ended: not in the ticket's criteria; a later ticket can add them.
- A package version bump: the change is test-only, so the changeset is empty.

## Further Notes

- The path sits under `packages/*/src/exec/**`, which the project rates sensitive, so the ticket runs in the standard lane although the diff is one test file.
- The grill stage was skipped because triage left no open decisions (`decisions_open` 0) and took no defaults; there is no grilling record, and nothing was defaulted.

## Ticket coverage

| Ticket item | Met by |
| --- | --- |
| Done when: a test fails if `READ ONLY` is removed from the `BEGIN` | Testing Decisions, success and failure cases (exact list starts `BEGIN READ ONLY`); mutation check |
| Done when: a test fails if the failure path stops issuing `ROLLBACK` | Testing Decisions, failure case; mutation check |
| AC: on success the recorded statements equal `["BEGIN READ ONLY", <sql>, "COMMIT"]` | Decision 2; Testing Decisions, success case |
| AC: on a failing query the statements equal `["BEGIN READ ONLY", <sql>, "ROLLBACK"]` and the runner rejects with an `AskDbError` | Decision 2; Implementation Decisions, failure switch; Testing Decisions, failure case |
| AC: mutation check, `READ ONLY` removed | Testing Decisions, mutation check |
| AC: mutation check, `ROLLBACK` dropped | Testing Decisions, mutation check |
| AC: existing lazy-load tests still pass unchanged | Implementation Decisions, which `pg` the runner reaches; Testing Decisions, unchanged |
| Out of scope: production code, other engines, Studio and integration tests, package bump | Decision 3; Out of Scope |
