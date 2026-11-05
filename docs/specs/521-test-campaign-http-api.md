# Spec: retire the redundant invalid-mode test in the http-api suite (#521)

## For the owner

This spec deletes the `invalid mode returns bad_request` test from the http-api server suite, because the existing null-mode test already reaches the same code path and checks more, and tightens that keeper so it also proves the header's value was the one rejected.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. What to retire | Delete `invalid mode returns bad_request`; keep `treats JSON null in optional body fields as absent` as the keeper; remove no other test and no production seam | The ticket: the campaign's ledger row and layer plan in #521's body | Two-way: revert the PR |
| 2. D1: tighten the keeper | The keeper's header-path check also asserts the error message contains `nope`, the header value sent | default D1 (triage) | Two-way: revert the line |
| 3. D2: leave the rest alone | No change to the `rule` check in the SQL-validation test (`toBeTruthy()`), and no new tests for the coverage gaps the campaign noted | default D2 (triage) | Two-way: nothing to revert |

```text
server.integration.test.ts
  ├─ "invalid mode returns bad_request"                 ──▶ [DELETED]
  │     header x-askdb-mode: nope, body mode absent → 400 bad_request
  └─ "treats JSON null in optional body fields as absent"  (keeper)
        body mode: null + header nope → 400, "Invalid mode", [+ "nope" (D1)]
```

**Risks:** almost none. The deleted test's one unique input (no `mode` key at all, rather than `mode: null`) takes the same branch in the server, so no regression it could catch goes unseen. The change is test-only and ships no package output.

**Done when:** the deleted test is gone and no other test is; the keeper asserts 400, "Invalid mode" and (D1) `nope`; `pnpm test` and `pnpm lint` pass; an empty changeset is added.

**Needs you:** nothing. Veto D1 or D2 by name if you disagree.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited `apps/http-api`'s tests and found one test that adds no protection. `invalid mode returns bad_request` sends an invalid `x-askdb-mode` header with no body `mode` and checks for a 400 `bad_request`. The keeper, `treats JSON null in optional body fields as absent`, sends the same header with body `mode: null`; the server's mode resolution treats an absent and a null body `mode` the same way, so both requests run the same branch, and the keeper also checks the "Invalid mode" message. The duplicate costs run time and reading time, and its `modes.askdbMode: "schema_only"` fixture suggests a behavior (config mode under an invalid header) that the test never actually checks.

## Solution

Maintainers get one test per contract on the request-mode path. The redundant test is deleted. The keeper stays and gains one assertion (D1): the error message names the header value it rejected, so the keeper proves the header was read and parsed, which the deleted test proved implicitly. Nothing in the server changes, and no other test, seam or helper moves.

## User Stories

1. As an http-api maintainer, I want each request-validation contract tested once, so that the suite stays quick to read and a failure points at one cause.
2. As an http-api maintainer, I want the invalid-header case still caught after the deletion, so that a regression that ignores or skips parsing `x-askdb-mode` still fails a test.
3. As an http-api maintainer, I want the keeper to show the header's value in the rejected message, so that a regression that rejects for some other reason (a stale body value, a config mode) doesn't pass it.
4. As a reviewer, I want the diff confined to the one test file, so that I can confirm at a glance that no production code or package output changed.
5. As a reviewer, I want no other test removed, so that the campaign's single C row is the whole change and the R rows stay intact.
6. As the campaign's next run, I want the ledger's C row resolved, so that the next audit of `apps/http-api` starts clean.
7. As a later contributor, I want the coverage gaps the campaign noticed (a valid header honored; the body `execute` field) left for their own issues, so that this change stays a pure consolidation.

## Implementation Decisions

- **Delete the redundant test (decision 1).** Remove the `invalid mode returns bad_request` block from the in-process server suite, fixture and all. Its `modes.askdbMode: "schema_only"` setting is never exercised, so nothing it sets up needs a new home.
- **Keep the keeper's existing assertions.** The null-body-plus-header half of `treats JSON null in optional body fields as absent` keeps its 400 status and "Invalid mode" message checks. The first half (all optional fields null → 200, SQL returned) stays as it is; it is what catches a regression that gates on `"mode" in body` rather than on the value.
- **Tighten the keeper (D1).** Add a check that the header-path error message contains `nope`. The core mode parser builds the message as `Invalid mode: "<raw value>". Expected one of: …`, so the value sent in the header appears in it. The check may be a second `toContain` or a single stricter match; either meets D1.
- **Leave the rest (D2).** The SQL-validation test's `rule` check stays `toBeTruthy()`. No test is added for a valid `x-askdb-mode` header or for the body `execute` field.
- **No production change, no seam change.** `server.ts` is untouched. The test-only export `mapAskError` and the runtime hooks `setAskDbRuntimeForTests` / `resetAskDbRuntimeForTests` stay: the layer plan found no seam this change unlocks.
- **Empty changeset.** `@askdb/http-api` is published, and changesets.yml treats `apps/http-api/src/` as publishable, so its `status` check requires a changeset even for a test-only change; build adds one with `pnpm changeset --empty`, since the package's output doesn't change.
- **No rename.** `server.integration.test.ts` keeps its name even though it needs no database; the campaign noted the suffix is a misnomer but harmless.

## Testing Decisions

- **What makes a good test here.** The keeper tests external behavior only: it posts to `/ask` over real HTTP against the in-process server and checks status and response body, never internal calls. D1's assertion stays on the response body.
- **Module tested.** The http-api server, through the existing in-process suite (layer 2 of the campaign's layer plan). No new seam: the existing `/ask` HTTP boundary is the highest one available in-repo.
- **Proof the keeper fails for the regressions the deleted test caught.** Header ignored → the keeper's request returns 200 and its status check fails. Header not parsed → same. Header parsed but the message lost or replaced → the `Invalid mode` and (D1) `nope` checks fail. Build should confirm one of these by briefly breaking the header branch locally (for example, skipping the header parse) and seeing the keeper go red, then restoring it.
- **Prior art.** The body-mode validation test in the same suite (`mode: "nope"` → 400, "Invalid mode") uses the same `postAsk` helper and message check shape.
- **Gates.** `pnpm test` (the deleted test absent, everything else green, the http-api suite one declaration shorter: 25 in `server.integration.test.ts`) and `pnpm lint`.

## Ticket coverage

| Ticket "Acceptance criteria" item | Met by |
| --- | --- |
| Each `F` row is repaired | None in the ledger (F 0); nothing to do |
| Each `C` row is consolidated into its named keeper, with the carried-over assertions | Decision 1 (delete `:292`, keeper `treats JSON null…`); the plan carries over no assertion, and D1 adds the optional one |
| Each `D` row is deleted, with its remaining proof intact | None in the ledger (D 0); nothing to do |
| Each test-only seam the plan unlocks is removed | The plan unlocks none; Implementation Decisions, "No production change, no seam change" |
| `pnpm test` green and `pnpm lint` passes | Testing Decisions, "Gates" |
| Row: `server.integration.test.ts:292 — invalid mode returns bad_request (C)` | Decision 1 |

## Out of Scope

- Tightening the SQL-validation test's `rule` check from `toBeTruthy()` to the exact core code (D2; worth its own issue).
- New tests for a valid `x-askdb-mode` header being honored, and for the body `execute` field branch (coverage gaps the campaign noted; their own issues).
- Renaming `server.integration.test.ts`.
- Any change to `server.ts`, `bin.test.ts`, `map-ask-error.test.ts` or the consumer lab.
- The known product notes #285 (`explain` omitted rather than `null`) and #277 (tenant-policy schema over HTTP fails closed with 500).

## Further Notes

- The ticket went through grilling with no grilling record, so the only decisions are the ticket's own plan and triage's two defaults.
- Line numbers in the ticket (`:292`, `:508-510`) are at head `2ff9332c`; build should find the tests by name.
