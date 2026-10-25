# Spec: apply the `postgres` test-campaign plan (#514)

## For the owner

This spec applies the weekly test campaign's plan to `@askdb/postgres`: it deletes 6 tests that duplicate a keeper or can't detect what they claim, repairs 2 tests so they fail for the regression they name, removes a dead production import kept "for tests", and stops `connector/test-utils.js` shipping in the published `dist/` (with a patch changeset).

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| D1. Seam cleanup in scope | Remove the dead `POSTGRES_TEMPLATES` import and `void` line from the connector's describe module, in this PR | default D1 (triage) | Two-way: revert the PR |
| D2. Packaging fix | Exclude `src/**/test-utils.ts` in the postgres build config, correct the helper's header comment, add a patch changeset for `@askdb/postgres`. Leave introspect's stale exclude and the `coerceRows` export alone | default D2 (triage) | Two-way: revert restores the file in `dist/` |
| D3. Lazy-`pg` test repair | Assert the message equals `missingDriverMessage({ engine: "Postgres", packageName: "pg" })` and keep the `AskDbError` name check. Sibling engines' lazy tests stay with their own campaign issues | default D3 (triage) | Two-way |
| D4. Coverage gaps and possible product bugs | Not fixed here; build files them as follow-up issues | default D4 (triage) | Two-way |

No decision here was settled by the owner: the ticket passed the grill stage with no grilling record, so all four are triage's defaults, which you veto by naming one (`/changes D2: …`).

```text
@askdb/postgres
├─ label.test.ts ............... delete 1 it.each row (kit allowlist replay)
├─ connector/describe.test.ts .. delete 3 tests (self-compare, default include, dup missing-manifest)
├─ connector/render-integration  delete 2 tests (newline, indent) · REPAIR toV2SchemaJson → toEqual(golden)
├─ exec/postgres.lazy.test.ts .. REPAIR message → equals missingDriverMessage(Postgres, pg)
├─ connector/describe.ts ....... drop dead POSTGRES_TEMPLATES import + `void` line   (D1)
├─ connector/test-utils.ts ..... header comment corrected                           (D2)
├─ tsconfig.build.json ......... exclude src/**/test-utils.ts → not in dist/        (D2)
└─ .changeset/*.md ............. patch: @askdb/postgres                              (D2)
```

**Risks:** the build script doesn't clean `dist/`, so a stale `test-utils.js` survives a local rebuild; the check must build from an empty `dist/`. The lazy test is under `packages/*/src/exec/**`, a sensitive path, though only its assertions change.

**Done when:** the 6 tests are gone and each keeper still passes; both repaired tests are shown failing under the named regression and passing without it; a fresh build of `packages/postgres` has no `connector/test-utils.js`; the changeset is present; `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing beyond approving or vetoing D1 to D4.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The maintainer wants `@askdb/postgres`'s tests to be ones that can fail. The weekly campaign (`factory-test-audit`, campaign mode, at `2ff9332c`) found 8 of its 51 ledger rows don't earn their place. Six duplicate a keeper elsewhere or can't detect what their name says: they cost run time and reading time and give false confidence. Two assert only part of their contract: the `toV2SchemaJson` test checks four fields of an object it claims equals the written file, and the lazy-`pg` message test replays the kit's message text but would pass if the Postgres runner were wired with MySQL's message. Alongside, the connector's describe module keeps a dead import justified by a test that doesn't exist, and the snapshot test helper `connector/test-utils.ts` compiles into the published `dist/`, where its own header says (wrongly) it's excluded.

## Solution

The postgres suite keeps one test per contract, at the keeper the campaign's layer plan names, and each kept test can fail for the regression its name promises. The published `@askdb/postgres` package no longer carries the test helper. Hosts see no behaviour change; the package's `dist/` loses one file that its `exports` map never exposed.

## User Stories

1. As the maintainer, I want the export-bundle label row for `./exports?password=S3cret` removed from the postgres label test, so that the kit's allowlist is tested once, in the kit's own label test.
2. As the maintainer, I want the "is deterministic" self-compare in the describe tests removed, so that determinism is proven only where it can fail: the golden byte comparison and the live multi-engine test.
3. As the maintainer, I want the "no include filter by default" test removed, so that no test claims to prove a default its runner can't see (the snapshot runner ignores SQL params).
4. As the maintainer, I want the default-include question left to open #239 and the live multi-engine test, so that this PR doesn't pin one side of an open decision.
5. As the maintainer, I want the duplicate "rejects missing from-export bundles" test in the describe tests removed, so that the bundle tests' version, which uses a real empty directory instead of a host-dependent `/tmp/x`, is the single keeper.
6. As the maintainer, I want the render "trailing newline" and "2-space indentation" tests removed, so that the golden byte-for-byte test is the single proof of the rendered bytes.
7. As the maintainer, I want the `toV2SchemaJson` test to compare the whole pure form to the parsed golden file, so that a divergence in any field (types, nullability, sensitivity) between the pure form and the written file fails it.
8. As a consumer of `toV2SchemaJson` (Prisma's and SQLite's tests use it), I want its equality with the written file pinned, so that I can rely on it as the in-memory form of what `renderToSchemaV2` writes.
9. As the maintainer, I want the postgres lazy-`pg` message test to fail if the runner is wired with another engine's missing-driver message, so that the test proves Postgres wiring rather than replaying kit text the kit already pins.
10. As the maintainer, I want the lazy-`pg` test to keep checking the error is an `AskDbError`, so that the repair doesn't lose the error-type contract.
11. As a host developer without `pg` installed, I want the missing-driver message still to name Postgres, the `pg` peer and the install commands, so that the error tells me what to do (unchanged behaviour, now pinned by equality).
12. As a reader of the connector's describe module, I want the dead `POSTGRES_TEMPLATES` import and its misleading comment gone, so that the module's imports reflect what it uses.
13. As a host developer installing `@askdb/postgres`, I want the published `dist/` to carry no test helper, so that the package ships only what its `exports` map serves.
14. As a contributor, I want the test helper's header comment to say accurately how it's kept out of `dist/`, so that the next reader isn't misled.
15. As the maintainer, I want a patch changeset for `@askdb/postgres` naming the `dist/` change, so that the release notes record why the published file list shrank.
16. As a reviewer, I want each deleted test's keeper named in the PR and still passing, so that I can check no proof was lost.
17. As a reviewer, I want evidence that each repaired test fails under its named regression, so that I can trust it isn't another test that can't fail.
18. As the maintainer, I want the campaign's coverage gaps (`BEGIN READ ONLY` runner contract, provider `createConnector`, bundle schema filtering) and its four possible product bugs filed as their own issues, so that they're tracked without growing this PR.
19. As the maintainer of the mysql, sqlite and sqlserver packages, I want their lazy tests left to their own campaign issues, so that each lane's PR stays reviewable on its own.

## Implementation Decisions

- **Deletions (the six D rows).** Delete exactly these, nothing else in their files:
  - postgres label tests: the `["./exports?password=S3cret", FALLBACK]` row of the export-bundle `it.each`; the `./exports/pagila` row and the rest of the block stay. Keeper: the kit label test's `{ file: "app.db?key=secret" }` → fallback case.
  - describe tests: "is deterministic — two runs produce a byte-identical SqlSchema JSON". Keepers: the golden byte test in the render tests; live determinism in the multi-engine integration test.
  - describe tests: "no include filter by default — all non-system schemas returned". Its only assertion (`schemas == ["public"]`) is made by the first describe test; the live default is in the multi-engine integration test. Delete, don't repair: asserting the params would pin one side of #239.
  - describe tests: "describe() rejects missing from-export bundles with a clear error". Keeper: the bundle tests' missing-manifest case.
  - render tests: "ends with a trailing newline (matches Phase 5 fixtures)" and "uses 2-space indentation". Keeper: "reproduces the orders-users golden byte-for-byte".
  - Remove any import or fixture helper a deletion leaves unused, so lint stays clean.
- **Repair: `toV2SchemaJson` equality.** In "returns the same object renderToSchemaV2 writes", replace the version, schemaId, table-name and relationship assertions with one deep-equality assertion of `toV2SchemaJson(result.schema, "orders-users")` against `JSON.parse` of the `orders-users.expected-schema.json` golden. This holds because `renderToSchemaV2` writes exactly `JSON.stringify(toV2SchemaJson(...), null, 2) + "\n"` on a clean write. The test name stays.
- **Repair: lazy-`pg` message (D3).** In "invoking the runner when `pg` is missing rejects with a helpful AskDbError", replace the five message regexes with equality to `missingDriverMessage({ engine: "Postgres", packageName: "pg" })`, imported from `@askdb/introspect/kit` (already a dependency; the package's production code imports from it). Keep the `name === "AskDbError"` assertion. The other three tests in the file are unchanged.
- **Dead import (D1).** Remove `POSTGRES_TEMPLATES` from the describe module's templates import, and the `void POSTGRES_TEMPLATES;` line with its comment. `POSTGRES_TEMPLATES` stays exported from the connector's index and used by the test helper.
- **Packaging (D2).** Add `"src/**/test-utils.ts"` to the `exclude` list of `packages/postgres`'s build tsconfig. Only test files import the helper, and the package `exports` map serves only `.`, so nothing published depends on it. Rewrite the helper's header comment to say the build config excludes it by name. `pnpm lint` for the package uses the same config, so it stops type-checking the helper, as it already skips the test files that use it; vitest still compiles it.
- **Changeset (D2).** One `patch` changeset for `@askdb/postgres`: the published `dist/` no longer includes the connector's snapshot test helper; no API change.
- **Follow-ups (D4).** Build files one issue each for the three coverage gaps (the catalog runner's `BEGIN READ ONLY` / `COMMIT` / `ROLLBACK`, `postgresConnectorProvider.createConnector`, bundle `isSystemSchema` and schema filtering) and one for the possible product bugs listed in #514 (to be reproduced first), linking #514. They are not code in this PR.
- **Not touched.** `coerceRows`'s export, `packages/introspect`'s stale `src/postgres/test-utils.ts` exclude, sibling engines' lazy tests, and moving the render-merge tests into `@askdb/introspect`.

## Testing Decisions

- **What a good test is here:** it asserts the package's external behaviour (the rendered schema, the error a host sees) at the seam it already uses, and it can fail for the regression its name names. No new seams: every change uses the existing snapshot runner, the golden fixture and the lazy test's `vi.mock` of `pg`.
- **Failure evidence for the F rows:** build shows each repaired test failing under its regression, then reverts the mutation:
  - lazy test: wire `engine: "MySQL"` into the Postgres runner's `missingDriverMessage` call; the repaired test fails, the old one passed.
  - `toV2SchemaJson`: change one field the old test didn't check (a column's `nullable` or type) in the parsed expectation or the pure form; the repaired test fails.
  - Record both runs in one line each in the PR body.
- **Keepers for the D rows:** build confirms each keeper named above still exists and passes, and lists them in the PR body.
- **Packaging check:** delete `packages/postgres/dist/`, run the package build, and confirm `dist/connector/test-utils.js` and `.d.ts` are absent (the build doesn't clean `dist/`, so a rebuild over an old `dist/` proves nothing). Optionally `pnpm pack` and check the file list.
- **Suite:** `pnpm test` and `pnpm lint` pass. The integration tests that need `DATABASE_URL` or `ASKDB_FIXTURE_HOST` are untouched and may stay skipped.
- **Prior art:** the kit's `driver.test.ts` already pins `missingDriverMessage` text by equality; the render tests' golden byte test is the pattern for the `toV2SchemaJson` comparison.
- Gate each changed test with `factory-test-audit`.

## Ticket coverage

| Ticket criterion | Met by |
| --- | --- |
| Each F row repaired and able to fail for its regression | Implementation: both repairs; Testing: failure evidence |
| Each C row consolidated into its keeper | None in this plan (C 0) |
| Each D row deleted; its keeper exists and passes | Implementation: deletions; Testing: keepers |
| Each test-only production seam removed | Implementation: dead import (D1); packaging (D2) |
| `connector/test-utils.js` absent from a fresh build | Implementation: packaging (D2); Testing: packaging check |
| Patch changeset for `@askdb/postgres` | Implementation: changeset (D2) |
| `pnpm test` and `pnpm lint` pass | Testing: suite |
| Rows: `label.test.ts:91` row 2 (D) | Deletions, first bullet |
| Rows: `describe.test.ts:82`, `:158`, `:300` (D) | Deletions, bullets 2 to 4 |
| Rows: `render-integration.test.ts:71`, `:77` (D) | Deletions, bullet 5 |
| Rows: `render-integration.test.ts:256` (F) | Repair: `toV2SchemaJson` equality |
| Rows: `exec/postgres.lazy.test.ts:116` (F) | Repair: lazy-`pg` message (D3) |

## Out of Scope

- The mysql, sqlite and sqlserver lazy tests (their own campaign issues).
- `packages/introspect`'s stale `test-utils` exclude, and un-exporting `coerceRows`.
- New tests for the `BEGIN READ ONLY` runner contract, `createConnector`, or bundle schema filtering (follow-up issues, D4).
- The four possible product bugs in #514: quoted text-array split, live/bundle system-schema disagreement, view column order (follow-up issue, D4; the fourth, packaging, is fixed here).
- Moving the render-merge tests into `@askdb/introspect`.

## Further Notes

- The campaign sized this for the quick lane at 7 files; with the changeset it is 8, and the lazy test sits in a sensitive path, so it runs in the standard lane.
- Campaign source: #514's ledger rows and layer plan, at head `2ff9332c`. Triage verified each row against the code at that head.
