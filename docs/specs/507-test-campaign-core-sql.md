# Spec: apply the core-sql test campaign plan (#507)

## For the owner

This spec applies the core-sql test campaign's plan to four test files in `@askdb/core`: one test renamed, five duplicate tests folded into named keepers (two keepers gain an assertion), one test deleted. No production code changes.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. The seven marked tests and what happens to each | Rename 1 (F), consolidate 5 (C), delete 1 (D), as the issue's ledger rows say | The campaign plan in the issue body (filed by the factory), confirmed at triage with no open decisions | Two-way: revert the PR |
| 2. Carry-over into the bind keeper | The MySQL trailing-backslash test also binds a second placeholder `:t = " OR 1=1"` and asserts the whole bound statement | Campaign plan, carry-over assertions; triage Agent Brief | Two-way |
| 3. Carry-over into the dialect-spec keeper | The "covers every DialectId" test also loops over `SUPPORTED_DIALECT_IDS` and asserts its sorted copy equals the typed id list | Campaign plan, carry-over assertions; triage Agent Brief | Two-way |
| 4. Test-only production seams | None to remove | Campaign plan, "Seams unlocked: none" | Two-way |
| 5. The two possible product bugs in the issue | Out of scope; not fixed or filed here | Triage, Out of scope | Two-way |

```text
generate.test.ts      "keeps the flag-off prompt byte-identical…"   ──rename──▶ "parameterize false and omitted send the same prompt, without parameterize instructions"
validate.test.ts      "accepts WITH ... SELECT"                     ──fold──▶  "accepts window functions and CTEs"           (unchanged)
                      "allows benign column names … 'delete'"       ──fold──▶  "matches blocked keywords on whole tokens…"   (unchanged)
bind.test.ts          "escapes the two-parameter injection shape…"  ──fold──▶  "escapes trailing backslash under MySQL…"     [+ :t on the bound SQL]
                      "substitutes correctly when later … longer"   ──fold──▶  "binds string/number/… for postgres"          (unchanged)
                      "rebinds a JSON-serialized PreparedQuery…"    ──delete── proof stays in consumer-lab + client rebind tests
dialect-spec.test.ts  "SUPPORTED_DIALECT_IDS enumerates all…"       ──fold──▶  "BUILT_IN_DIALECTS covers every DialectId"    [+ SUPPORTED_DIALECT_IDS check]
```

**Risks:** a removed test could hold an input its keeper doesn't; the ledger and triage checked each pair, and the spec repeats the check below. The files sit under a sensitive path (`packages/core/src/sql/**`), which is why this runs in the standard lane.

**Done when:** the seven rows are applied as above, the two keepers carry their new assertions, no production file changes, `pnpm test` and `pnpm lint` pass, and the consumer-lab rebind test passes against the fixture.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited the SQL tests of `@askdb/core` (generation, validation, lexing, binding, parameter manifest, dialect specs, SQL extraction, prompt identifiers, schema-question precheck) read-only at `2ff9332c` and marked 7 of 138 tests. One test's name claims a check it doesn't make (byte-identity with a "pre-parameterize path" that no longer exists). Five tests repeat an input and assertion a keeper already covers, and one of them (the MySQL "two-parameter injection shape") never composes the two parameters it names. One test (the JSON round-trip rebind) copies a hand-built object through `JSON.parse(JSON.stringify(...))`, so it can't catch the non-serializable field it exists to catch. Maintainers reading these suites see more tests than contracts, and one name misleads.

## Solution

The suites keep the same contracts with fewer, truer tests. The misnamed generate test says what it checks. The duplicates go, and the two keepers that need it gain the assertion the duplicate promised but didn't make: the MySQL escaping keeper asserts the two-parameter injection shape on a bound statement, and the dialect registry keeper asserts that the exported id list equals the typed id list. The JSON round-trip test goes; real-output rebind stays proven by the consumer lab and the client's rebind test.

## User Stories

1. As a maintainer reading `generate.test.ts`, I want the parameterize flag-off test named for what it asserts, so that I don't believe it guards byte-identity with an old prompt.
2. As a maintainer, I want the renamed generate test's assertions left exactly as they are, so that the rename can't weaken it.
3. As a maintainer reading `validate.test.ts`, I want one test per accepted input class, so that a `WITH … SELECT` acceptance lives in one place.
4. As a maintainer, I want the whole-token keyword test to remain the one place that accepts `deleted_at`, so that the substring rule has one owner.
5. As a maintainer of `bind.ts`, I want the MySQL injection shape (`\` in one parameter, ` OR 1=1` in the next) asserted on the bound SQL, so that a regression where a trailing backslash swallows the closing quote and lets the next value break out fails a test.
6. As a maintainer, I want the Postgres half of the trailing-backslash test unchanged, so that the per-dialect contrast stays.
7. As a maintainer, I want the right-to-left substitution test removed, so that the offset proof lives in the scalar-binding tests, whose literals all differ in length from their placeholders.
8. As a maintainer, I want the JSON round-trip test removed, so that the suite doesn't claim serialization proof it can't give.
9. As a maintainer, I want the consumer-lab rebind test and the client's rebind test still present and passing, so that rebinding a stored `PreparedQuery` stays proven after the round-trip test goes.
10. As a maintainer of `dialect-spec.ts`, I want one test that checks the registry, its keys, each spec's `id` and the exported `SUPPORTED_DIALECT_IDS` list against the typed `DialectId` list, so that adding a dialect means updating one test.
11. As a maintainer, I want `SUPPORTED_DIALECT_IDS` compared as a sorted set, not by length, so that the check fails on a wrong id and not only on a wrong count.
12. As a reviewer, I want no production file and no export changed, so that the PR is reviewable as test-only.
13. As a reviewer, I want each removal traceable to its ledger row and keeper, so that I can confirm no unique input was lost.
14. As a release manager, I want no changeset, since no published package output changes.

## Implementation Decisions

- **Rename (F, generate suite).** The `generateSelectSql — parameterize prompt + extras` test "keeps the flag-off prompt byte-identical to the pre-parameterize path" is renamed to say it checks that `parameterize: false` and an omitted flag send the same prompt, without parameterize instructions (for example "parameterize false and omitted send the same prompt, without parameterize instructions"). Its body is unchanged.
- **Validate consolidations (C).** Remove "accepts WITH ... SELECT" (keeper: "accepts window functions and CTEs", which accepts a `WITH … SELECT` through the same `accept` helper) and "allows benign column names that contain substring 'delete'" (keeper: "matches blocked keywords on whole tokens, not substrings", which accepts `deleted_at` under Postgres). Both keepers stay unchanged.
- **Bind consolidation of the injection shape (C, decision 2).** Remove "escapes the two-parameter injection shape under MySQL" from the `escapeSqlLiteral` describe. Extend the MySQL half of "escapes trailing backslash under MySQL but not Postgres" so it binds a statement with two placeholders, `:s` = a single backslash and `:t` = ` OR 1=1`, and asserts the full bound SQL: `SELECT * FROM t WHERE s = '\\' AND t = ' OR 1=1'` as the database sees it (the backslash doubled), which in a TypeScript string literal is written with four backslashes. The MySQL bind needs a parameter list with both entries; the Postgres half keeps its single `:s` statement and assertion.
- **Bind consolidation of right-to-left substitution (C).** Remove the `bindPreparedQuery — right-to-left substitution` describe. Keeper: "binds string/number/boolean/date/datetime for postgres" in the scalars describe, where every literal differs in length from its placeholder, so an offset bug in the substitution loop already fails it.
- **Bind deletion (D).** Remove the `bindPreparedQuery — JSON round-trip` describe. Remaining proof, which must still exist: the consumer lab's results test that rebinds `ask()`'s real `preparedQuery` with a new value against live engines, and the client hooks test that rebinds a `PreparedQuery` through the client re-export.
- **Dialect-spec consolidation (C, decision 3).** Remove "SUPPORTED_DIALECT_IDS enumerates all shipped specs". In "BUILT_IN_DIALECTS covers every DialectId (exhaustive)", also iterate `SUPPORTED_DIALECT_IDS` with the same two assertions (spec defined, spec `id` equals the key), and assert the sorted copy of `SUPPORTED_DIALECT_IDS` equals the sorted typed id list. The typed list stays the source of truth, so a new `DialectId` fails to type-check until it's listed.
- **No seams.** No production export is removed or added (decision 4): every export these tests import has a non-test caller.
- **No changeset.** Test files are not in any package's published output.

## Testing Decisions

- A good test here checks the public export's behavior (`generateSelectSql`, `validateSelectSql`, `bindPreparedQuery`, `escapeSqlLiteral`, the dialect registry exports), not internals. The edits keep every remaining test at that seam; no new seam is added.
- The two extended keepers must fail for the regression they now name. Build checks this once by hand: break the MySQL backslash escaping (or the second placeholder's expected text) and see the bind keeper fail; drop an id from the typed list's sorted comparison and see the dialect keeper fail. Revert both before committing.
- Run the four suites, then `pnpm test` and `pnpm lint` at the root. The test count for `@askdb/core` drops by exactly 6: two validate, three bind and one dialect-spec test go, and the renamed test stays.
- The deleted round-trip test's remaining proof must exist and pass. The client hooks rebind test runs in `pnpm test`. The consumer-lab results test ("bindPreparedQuery rebinds the value…") is outside the workspace and needs the multi-engine fixture, so build runs it on its own: `pnpm lab:up`, then `pnpm -C examples/consumer-lab exec vitest run test/results.test.ts -t "bindPreparedQuery rebinds"`, and reports the result in the PR. It must pass, not skip (a missing `cli-introspect-engine` capability skips it). If build's environment can't start the fixture, build escalates for a run rather than marking the criterion met.
- Prior art: the existing per-dialect escaping matrix in the bind suite and the registry tests in the dialect-spec suite.

## Out of Scope

- The two possible product bugs in the issue: `isBuiltInDialectId` accepting `Object.prototype` keys, and manifest cross-validation scanning placeholders with the generic lexer. Neither is reproduced or filed here.
- The unused `sql/index.ts` barrel and `void scalarValueSchema` in the parameter manifest module.
- Any test not named in the ledger rows, and any file other than the four test files.

## Ticket coverage

| Done when (acceptance criterion) | Met by |
| --- | --- |
| Each F row repaired (generate rename) | Implementation Decisions: Rename; decision 1 |
| Each C row consolidated into its keeper, with carry-over assertions | Validate consolidations; bind consolidations; dialect-spec consolidation; decisions 2 and 3 |
| Each D row deleted, remaining proof still exists and passes | Bind deletion; Testing Decisions (client rebind test in `pnpm test`, consumer-lab rebind test run against the fixture) |
| Each test-only seam removed (none) | No seams; decision 4 |
| `pnpm test` green and `pnpm lint` passes | Testing Decisions |
| Triage: generate test renamed, assertions unchanged | Rename |
| Triage: two validate duplicates gone, keepers unchanged | Validate consolidations |
| Triage: three bind tests removed, MySQL keeper asserts the two-parameter shape on the bound statement | Bind consolidations and deletion; decision 2 |
| Triage: dialect-spec duplicate gone, keeper asserts sorted `SUPPORTED_DIALECT_IDS` equals `allIds` | Dialect-spec consolidation; decision 3 |
| Triage: consumer-lab and client rebind tests still exist | Bind deletion; Testing Decisions (both run and pass) |
| Triage: no production file changes, no new test-only exports | No seams; decision 4 |

## Further Notes

- The ledger's line numbers match the files at `2ff9332c`, this branch's base. Build should find tests by name, not line, since the removals shift lines.
- The ticket passed the grill stage with no grilling record: triage listed no open decisions and took no defaults.
