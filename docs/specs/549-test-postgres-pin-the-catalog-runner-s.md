# Spec: pin the postgres catalog runner's BEGIN READ ONLY / COMMIT / ROLLBACK contract (#549)

## For the owner

This spec adds two test cases to the postgres runner's existing `pg`-mocking test file. They record every statement the built-in catalog query runner sends and assert the exact order on success and on a failing query, so dropping `READ ONLY` or the failure-path `ROLLBACK` fails a test. Production code does not change, and no changeset is added.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Where the test lives | The existing lazy-load test file beside the runner, which already mocks `pg` | Issue's "Suggested shape", adopted as the acceptance criteria at triage (Open decisions: "none open") | Two-way: revert |
| 2. Technique | The fake `pg` client records each statement; the tests assert the whole recorded list, the way Studio's execute-registry test does | Same | Two-way |
| 3. Success order | `BEGIN READ ONLY`, the catalog SQL, `COMMIT`, and nothing else | Triage acceptance criteria | Two-way |
| 4. Failure order | `BEGIN READ ONLY`, the catalog SQL, `ROLLBACK`, and nothing else; the runner rejects with an `AskDbError` naming the underlying failure | Triage acceptance criteria | Two-way |
| 5. Out of this ticket | No production change, no other engines' runners, no Studio or integration test change, no changeset | Triage Agent Brief, Out of scope | Two-way |

```text
packages/postgres/src/exec
  postgres.ts               [unchanged]  BEGIN READ ONLY → sql → COMMIT | catch: ROLLBACK → AskDbError
  postgres.lazy.test.ts     [add]        recording fake pg client (switched on per test)
                                         + "success: BEGIN READ ONLY, sql, COMMIT"
                                         + "failing query: BEGIN READ ONLY, sql, ROLLBACK, AskDbError"
```

**Risks:** the file's `pg` mock returns the real driver by default and other tests depend on that; the recording fake must be switched on only for the new cases and reset in `beforeEach`. The diff sits under the sensitive `packages/*/src/exec/**` path, which is why this is standard lane, though it is test-only.

**Done when:** removing `READ ONLY` from the `BEGIN` fails a new test; removing the failure-path `ROLLBACK` fails a new test; the four existing lazy-load tests pass unchanged; `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

`createPostgresCatalogQueryRunner` is the read-only guard on AskDB's live Postgres introspection path: each catalog query runs on a fresh connection inside `BEGIN READ ONLY`, is committed on success, and is rolled back before the runner throws on failure. No test checks the statements it sends. The lazy-load test's fake `Pool` returns canned rows whatever it is sent, and the integration test needs a live database and records nothing. A contributor could drop `READ ONLY` from the `BEGIN`, or stop issuing `ROLLBACK` when the query fails, and every test would still pass. The postgres test campaign (#514) found the gap.

## Solution

Contributors get two unit tests that fail when the runner's transaction statements change. The tests run without a database: a fake `pg` client records each statement the runner sends, and the tests compare the recorded list to the exact expected order on the success path and on a failing query. The failing-query test also checks that the runner rejects with an `AskDbError` naming the underlying error. Nothing published changes.

## User Stories

1. As a contributor editing the postgres catalog runner, I want a test to fail if I remove `READ ONLY` from the `BEGIN`, so that I can't silently make catalog introspection run in a writable transaction.
2. As a contributor, I want a test to fail if the failure path stops issuing `ROLLBACK`, so that a failed catalog query never leaves a transaction open on the connection.
3. As a contributor, I want the success test to assert the whole statement list (`BEGIN READ ONLY`, the SQL, `COMMIT`), so that an extra statement, a missing `COMMIT` or a stray `ROLLBACK` also fails it.
4. As a contributor, I want the failure test to assert the whole statement list (`BEGIN READ ONLY`, the SQL, `ROLLBACK`), so that a `COMMIT` sent after a failed query also fails it.
5. As a contributor, I want the failure test to assert the runner rejects with an `AskDbError` whose message names the underlying failure, so that the error wrapping on that path is pinned along with the rollback.
6. As a contributor, I want the tests to run with no database and no env var, so that they run in every `pnpm test`, locally and in CI.
7. As a maintainer of the lazy-load tests, I want the existing four tests to keep the real `pg` driver and the temp-project fixture they use today, so that the lazy-load and `resolveFrom` contracts stay proven exactly as before.
8. As a maintainer, I want the recording fake switched on only by the new tests and reset before each test, so that it can't leak into the lazy-load cases.
9. As a reviewer, I want the PR body to show the two mutation checks (remove `READ ONLY`; remove the `ROLLBACK`) failing the new tests, and passing again once restored, so that I can trust the tests without re-running the mutations.
10. As a reviewer, I want the prior art (Studio's execute-registry statement recording) followed, so that statement-order tests read the same across the repo.

## Implementation Decisions

- **Production code is untouched.** `createPostgresCatalogQueryRunner(connectionString, options?)` and its `CatalogQueryRunner` behaviour stay as they are.
- **The fake sits where the runner's `pg` import resolves.** The runner loads `pg` through the optional-driver loader, whose first path is the engine package's own `import("pg")`, which the file's `vi.mock("pg")` factory already intercepts (it returns the real driver today, or throws to simulate a missing peer). The new tests take that path: a per-test switch in the file's hoisted mock state makes the factory return a fake module whose `Pool` hands out a client that pushes each statement it is sent onto a recorder in the same state. The second path (the temp-project CJS fixture, reached only when the engine import fails) is left to the existing `resolveFrom` tests. Each test re-imports the runner module after `vi.resetModules()`, so the loader's driver cache does not carry a module from one test into the next.
- **The fake client's behaviour.** It records the SQL text of every `query` call in order. For the catalog SQL it returns rows with `fields`, or throws an `Error` when the test asks for a failure; for every other statement it returns an empty result. `release()` and `Pool.end()` are no-ops. The fake mirrors only what the runner calls; it does not model `pg`.
- **The catalog SQL is called without params.** That is the path the issue names; the params branch sends the same transaction statements and is not a separate contract here.
- **Assertions.** Success: the recorded list equals `["BEGIN READ ONLY", <sql>, "COMMIT"]`, and the runner resolves to the columns and rows the fake returned. Failure: the recorded list equals `["BEGIN READ ONLY", <sql>, "ROLLBACK"]`, and the runner rejects with an error named `AskDbError` whose message contains the fake's error text. Whole-list equality covers "no `ROLLBACK` on success" and "no `COMMIT` on failure" without separate checks.
- **Reset.** The file's `beforeEach` turns the recording fake off and clears the recorder, alongside its existing resets.

## Testing Decisions

- A good test here checks what the runner sends to the driver and what it returns, the runner's observable contract with `pg`, and not how `runPostgresCatalogQuery` is structured inside.
- Module tested: `@askdb/postgres`, the built-in catalog query runner, through its public factory.
- Acceptance evidence is two mutation checks, run by hand and recorded in the PR body: change `BEGIN READ ONLY` to `BEGIN` and see the new tests fail; delete the failure-path `ROLLBACK` call and see the failing-query test fail; restore and see both pass.
- Prior art: `apps/studio/src/execute-registry.unified.test.ts`, whose `pgQueries` recorder and "postgres runs one statement … inside a read-only transaction" test assert an exact statement list; and the lazy-load file's own hoisted `pgState` and `vi.mock("pg")` factory.
- Validation: `pnpm --filter @askdb/postgres test`, then `pnpm test` and `pnpm lint` at the root.

## Ticket coverage

| Ticket item (issue "Done when" and triage acceptance criteria) | Met by |
| --- | --- |
| A test fails if `READ ONLY` is removed from the `BEGIN` | Decision 3; Implementation "Assertions"; Testing mutation check |
| A test fails if the failure path stops issuing `ROLLBACK` | Decision 4; Implementation "Assertions"; Testing mutation check |
| On success the recorded statements equal `["BEGIN READ ONLY", <sql>, "COMMIT"]` | Decision 3; Implementation "Assertions" |
| On a failing query the recorded statements equal `["BEGIN READ ONLY", <sql>, "ROLLBACK"]` and the runner rejects with an `AskDbError` | Decision 4; Implementation "Assertions" |
| The existing lazy-load tests still pass unchanged | Implementation "The fake sits where…" and "Reset"; user stories 7 and 8 |

## Out of Scope

- Any change to `postgres.ts` or other production code.
- Statement-recording tests for the mysql, sqlite and sqlserver catalog runners. Each belongs to its own campaign follow-up.
- Changes to Studio's execute-registry test or to the postgres integration test.
- Pinning the params branch, the swallowed `ROLLBACK` error, or the pass-through of an error that is already an `AskDbError`. They are not in the ticket's "Done when".
- A changeset: the diff is test-only.

## Further Notes

- No grilling record exists for this ticket (the grill stage had no open decisions), so no glossary terms or decision records come out of it. Triage took no defaults.
- Expected diff: one file, about 30 to 40 lines.
