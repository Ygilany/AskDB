# Spec: repair two fragile http-api integration tests (#576)

## For the owner

This spec makes two `http-api` integration tests able to fail for the regression each one names: the invalid-body-mode test asserts the `Invalid mode` message for a non-string `mode` and gains an empty-string `mode` row, and the SQL-validation test asserts `rule` is exactly `SQL_NOT_SELECT_OR_WITH`. Test-only, one file, no changeset.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Mode test repair | Assert the `mode: 42` reply's message contains `Invalid mode`; add a `mode: ""` row asserting 400 and a message containing `Invalid mode`; keep the `"nope"` and `bounded_results` rows | Triage, Agent Brief (Key interfaces), from the campaign's ledger row | Two-way: revert the PR |
| 2. SQL-validation test repair | Replace the truthiness check on `error.rule` with an exact match on `SQL_NOT_SELECT_OR_WITH` | Triage, Agent Brief (Key interfaces) | Two-way |
| 3. What stays out | No production code (the exported `mapAskError` stays), none of the campaign's coverage gaps, none of the known product bugs (#285, #277, #343), no changeset | Triage, Agent Brief (Out of scope) | Two-way |

```text
POST /ask {mode: 42}  ─▶ guard ─▶ 400 bad_request "Invalid mode…"   [changed: message now asserted]
POST /ask {mode: ""}  ─▶ guard ─▶ 400 bad_request "Invalid mode…"   [changed: new row]
POST /ask (mock "delete from users") ─▶ 400 sql_validation_error, rule = SQL_NOT_SELECT_OR_WITH   [changed: exact rule]
```

**Risks:** none beyond the usual; the file is under `apps/http-api/src/**`, a sensitive path, which is why this runs in the standard lane though the diff is about seven lines.

**Done when:** both tests pass with the stronger assertions; deleting the body-mode guard's throw in `resolveRequestMode` turns the mode test red; the subsystem's `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign (factory-test-audit, campaign mode, at `5d9878c4`) marked two tests in the http-api integration suite fragile. In "invalid body mode returns bad_request", the `mode: 42` row checks only status and code. If the server's own body-mode guard were removed, core's mode parser would throw a `TypeError` on the number, the request handler would still map it to 400 `bad_request`, and the row would stay green while clients got an internal error message. The guard's other half, rejecting an empty-string `mode`, has no row at all: without the guard, core's parser maps `""` to the default mode, so the request would silently succeed in `schema_only`. In "SQL validation errors map to sql_validation_error + rule", `error.rule` is checked only for truthiness, so a regression that copies the wrong field into `rule` (the error's `name` or `message`) passes, though `rule` is the documented machine-readable rule code.

## Solution

The two tests are tightened in place. The mode test asserts the non-string reply's message contains `Invalid mode` and posts one more request with `mode: ""`, asserting 400 and the same message. The SQL-validation test asserts `rule` equals `SQL_NOT_SELECT_OR_WITH`, the code core's validator gives `delete from users`. Nothing else in the suite, and no production code, changes.

## User Stories

1. As an AskDB maintainer, I want the mode test to fail when the server's body-mode guard is removed, so that a non-string `mode` keeps getting a client-facing `Invalid mode` message instead of a leaked internal `TypeError` message.
2. As an AskDB maintainer, I want an empty-string body `mode` to be tested as a 400, so that it can't silently fall back to the default mode.
3. As an HTTP API client, I want an invalid `mode` (wrong type, empty, or unknown) to get 400 `bad_request` with a message that names the problem and the allowed modes, so that I can fix my request.
4. As an HTTP API client, I want `sql_validation_error` replies to carry the exact core rule code in `rule`, so that I can branch on it as the reference docs say.
5. As an AskDB maintainer, I want the SQL-validation test to fail when `rule` carries anything but the rule code, so that the mapping from core's `SqlValidationError` stays correct without relying on the fixture-gated consumer lab.
6. As an AskDB contributor, I want the existing `"nope"` and `bounded_results` rows kept, so that the unknown-value and valid-value paths stay covered.
7. As a reviewer, I want the change confined to the one test file, so that I can see at a glance that no production behavior moved.

## Implementation Decisions

- **Module under test:** the http-api server, driven over real HTTP in-process by the existing integration suite (the `installTestRuntime` / `startApp` / `postAsk` helpers, with `dev.mockSql` standing in for the model). Production code is not modified.
- **Mode guard contract:** `resolveRequestMode` rejects a body `mode` that is present (not `undefined` or `null`) and is not a string or is blank, throwing `Invalid mode: <JSON value>. Expected one of: schema_only, bounded_results.`; the request handler turns that into 400 `bad_request` with the error's message. Core's `parseAskDbModeV1` gives the same `Invalid mode` message for an unknown string, which is why the `"nope"` row cannot catch the guard's removal and the `42` and `""` rows can.
- **Mode test changes (decision 1):** after the `mode: 42` row's status and code checks, assert its `error.message` contains `Invalid mode`. Add a row posting `{ question: "hi", mode: "" }` that asserts status 400 and an `error.message` containing `Invalid mode`; asserting `error.code` is `bad_request` too, as the sibling rows do, is fine. The `"nope"` and `bounded_results` rows stay as they are. The new row can sit in the same test, as the issue's plan has it.
- **SQL-validation test change (decision 2):** the `toBeTruthy()` check on `error.rule` becomes an exact equality with `SQL_NOT_SELECT_OR_WITH`. The mock SQL `delete from users` fails core's validator at that rule (it does not start with `SELECT`/`WITH`), matching what the consumer lab's packed-bin suite asserts. The other assertions (400, `ok: false`, `sql_validation_error`) stay.
- **No changeset:** the change is confined to a `*.test.*` file under the package's `src`, which needs none (#560).

## Testing Decisions

- **What a good test is here:** it observes only the HTTP reply (status, `error.code`, `error.message`, `error.rule`), never the server's internals.
- **Break-it checks (by hand during build, not committed):**
  - Delete the guard's `if` block (the non-string/blank check and its throw) in `resolveRequestMode` and confirm the mode test fails (the `42` row's message no longer contains `Invalid mode`, and the `""` row gets 200); restore.
  - Change the `rule` the SQL-validation mapping copies (for example to the error's `name`) and confirm the SQL-validation test fails; restore.
  - Report both in the PR body.
- **Unchanged:** the suite's other 23 tests and the two other files in the subsystem (`bin.test.ts`, `map-ask-error.test.ts`) pass as they are.
- **Prior art:** the `"nope"` row in the same test already asserts `error.message` contains `Invalid mode`; the new assertions follow it.
- **Gate:** each changed test passes the `factory-test-audit` authoring gate.

## Out of Scope

- Any production code change, including removing or narrowing the `mapAskError` export (still the only route to the 422 and name-fallback branches its unit test covers).
- The coverage gaps the campaign lists: the body `execute` field, a valid `x-askdb-mode` header being honored, `DialectNotSupportedError` → 400, and the bin's `--port`, unknown-option and `--help` exits.
- The known product bugs: `explain` omitted rather than `null` and the docs' `read_only` rule example (#285); a tenant-policy schema over HTTP failing with 500 (#277, #343).
- A changeset.

## Further Notes

- There are no `C` or `D` rows and no test-only production seams in the campaign's plan, so those acceptance criteria hold with no work.
- The grill stage ran no grilling: triage left no open decisions and took no defaults, so there is no grilling record and nothing here is a default.
- Last week's campaign ticket (#521, its D2) left the `rule` check out of scope as worth its own issue; none was filed, so this ticket picks it up.

## Ticket coverage

| Ticket item | Met by |
| --- | --- |
| Row `server.integration.test.ts:461` (F) repaired | Decision 1; Implementation Decisions, mode test changes |
| Row `server.integration.test.ts:292` (F) repaired | Decision 2; Implementation Decisions, SQL-validation test change |
| AC: each `F` row keeps its contract and can now fail for the named regression | Testing Decisions, break-it checks |
| AC: each `C` row consolidated | Further Notes (none in the plan) |
| AC: each `D` row deleted | Further Notes (none in the plan) |
| AC: each test-only production seam removed | Further Notes (none); Out of Scope (`mapAskError` stays) |
| AC: subsystem tests green with `pnpm test`, `pnpm lint` passes | For the owner, Done when; Testing Decisions, unchanged |
| Brief AC: non-string `mode` asserts `Invalid mode` | Decision 1 |
| Brief AC: `mode: ""` row asserts 400 and `Invalid mode` | Decision 1 |
| Brief AC: `rule` is exactly `SQL_NOT_SELECT_OR_WITH` | Decision 2 |
| Brief AC: deleting the body-mode guard turns the mode test red | Testing Decisions, break-it checks |
| Brief out of scope: production code, coverage gaps, #285/#277/#343, changeset | Decision 3; Out of Scope |
