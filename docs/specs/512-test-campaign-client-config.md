# Spec: apply the client-config test campaign plan (#512)

## For the owner

This spec applies the client-config test campaign's plan to three test files in `@askdb/client` and `@askdb/config`: two vacuous facade tests repaired so they can fail, seven duplicate tests folded into named keepers, six redundant tests deleted, and `client.hooks.test.ts` retired. No production code changes.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. The 15 marked tests and what happens to each | Repair 2 (F), consolidate 7 (C), delete 6 (D), as the issue's ledger rows say | The campaign plan in the issue body (filed by the factory), confirmed at triage with no open decisions | Two-way: revert the PR |
| 2. What the two repaired tests assert | "2. mock SQL path" captures `onResolve` and asserts `modelSource` `"mock"`; "3. model override" asserts `"override"`; both assert the registry's `resolveAiConfig` and `createLanguageModel` were not called, in place of the `createLanguageModelFromEnv` negative | Campaign plan, carry-over assertions; triage Agent Brief | Two-way |
| 3. Test-only production seams | None to remove; `setAskDbRuntimeForTests` / `resetAskDbRuntimeForTests` stay | Campaign plan, "Test-only production seams unlocked: none"; triage Out of scope | Two-way |
| 4. One PR or two | One PR; the client/config split is available as two commits, not two PRs | Triage, note for align | Two-way |
| 5. The optional `it.each` fold, unused `makeConfig` params and three coverage gaps | Out of scope; not done or filed here | Triage, Out of scope | Two-way |

```text
client.hooks.test.ts   "onResolve hook fires with … modelSource"    ──fold──▶  client.test.ts "2. mock SQL path"   [+ onResolve modelSource "mock"]
                       "imports PreparedQuery … and rebinds"         ──delete── proof stays in core bind scalars + consumer lab
                       (file deleted)
client.test.ts         "1. schema from … { path }"                   ──delete── proof stays in "7. caching"
                       "2. mock SQL path"                            ──repair── [modelSource "mock"; resolveAiConfig/createLanguageModel not called]
                       "3. model override"                           ──repair── [modelSource "override"; same negatives]
                       "6. missing key"                              ──delete── proof stays in "routes model resolution through the providers-built registry"
                       "builds the registry internally from providers" ─delete── same keeper
config.test.ts         6 flatten duplicates (postgres introspection, anthropic ×2, gateway, known providers, reasoning unset)
                                                                     ──fold──▶  compat table / postgres introspection keeper / drift / openai language.model   (unchanged)
                       "loads defineConfig projection from disk"     ──delete── proof stays in bootstrap-from-disk + direct loader tests
                       "defaults to postgres when no provider …"     ──delete── proof stays in the prisma → postgres default test
```

**Risks:** a removed test could hold an input its keeper lacks; the ledger checked each pair and the spec names every keeper below. `packages/config/src/**` is a sensitive path, which is why this runs in the standard lane. Sibling ticket #507 deletes core's JSON round-trip rebind test, which this ticket's deleted hooks test duplicates (see Needs you).

**Done when:** the 15 rows are applied as above, the two repaired tests fail when the facade consults the registry on their path, `client.hooks.test.ts` is gone, no production file changes, and `pnpm test` and `pnpm lint` pass.

**Needs you:**

> **Both #507 and #512 remove the "Utah" rebind scenario.** #507 deletes core's JSON round-trip rebind test and names this ticket's hooks rebind test as remaining proof; this ticket deletes that hooks test and the issue names the JSON round-trip test as proof. If both land, rebind is still proven: core's "binds string/number/boolean/date/datetime for postgres" asserts `sql`, `unboundSql` and `params` for a string parameter, "allocates one marker per repeated scalar occurrence" asserts `markers`, and the consumer lab imports `bindPreparedQuery` from the `@askdb/core` barrel and rebinds `ask()`'s real output. **Recommendation:** go ahead here, and build cites the two scalar tests and the consumer lab, not the JSON round-trip test, as this row's remaining proof. #507's spec should drop its citation of the hooks test when it is next revised.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited the `client-config` subsystem's tests (`@askdb/client`, `@askdb/config`, `@askdb/connectors`) read-only at `2ff9332c` and marked 15 of 140 declarations. Two facade tests check that the registry wasn't called by asserting on `createLanguageModelFromEnv`, which the facade stopped calling in #171, so they can't fail; the override test also passes both a model and a `generateText` stub, so it can't tell the override path from the mock path. Seven tests repeat an assertion a stronger keeper already makes. Six tests are redundant: one never touches `@askdb/client`, and others promise a scenario (a registry returning no model, a providers-built registry, the studio-execute default) they don't exercise. Maintainers reading these suites see more tests than contracts, and two of them give false confidence about the facade's registry bypass.

## Solution

The suites keep the same contracts with fewer, truer tests. The mock and override facade tests read the `onResolve` hook's `modelSource` and assert the registry's `resolveAiConfig` and `createLanguageModel` stayed untouched, so a regression that routes either path through the registry fails them. The hooks file's only distinct assertion (`modelSource` `"mock"`) moves into the mock test, and the file goes. The duplicate and redundant tests go; each one's proof stays in a named keeper that this PR leaves unchanged.

## User Stories

1. As a maintainer of the `createAskDb` facade, I want the mock-SQL test to fail if `config.dev.mockSql` stops short-circuiting the registry, so that a regression that calls a provider under mock mode is caught.
2. As a maintainer, I want the mock-SQL test to assert `onResolve` reports `modelSource` `"mock"`, so that the hook's mock reporting has one owner after the hooks file goes.
3. As a maintainer, I want the model-override test to assert `modelSource` `"override"`, so that it fails if the mock-deps branch starts winning over an explicit model.
4. As a maintainer, I want both repaired tests to assert on `resolveAiConfig` and `createLanguageModel`, the calls the facade makes today, so that the negative assertions can fail.
5. As a maintainer, I want `makeRegistry` to keep its `createLanguageModelFromEnv` stub, so that the mock still satisfies the `AiRegistry` type.
6. As a maintainer, I want `client.hooks.test.ts` removed, so that a test that never touches `@askdb/client` doesn't sit in the client package.
7. As a maintainer, I want the onResolve dialect behavior proven by the six dialect-precedence tests alone, so that the hooks file's weaker `dialect.source toBeDefined` isn't missed.
8. As a maintainer, I want rebinding a `PreparedQuery` still proven after the hooks test goes, by core's bind scalar tests and the consumer lab's barrel import and rebind, so that the deletion loses no contract.
9. As a maintainer, I want "1. schema from createAskDb({ schema: { path } })" removed, so that schema-from-path loading has one owner in "7. caching".
10. As a maintainer, I want "6. missing key" removed, so that the missing-model contract is owned by the tests that use a real providers-built registry and a real `keyMissingMessage`, not by a mock that returns the asserted message.
11. As a maintainer, I want "builds the registry internally from providers" removed, so that the providers option is proven by the test that actually reaches the adapter.
12. As a maintainer of `@askdb/config`, I want per-provider flat AI keys owned by the compat table, so that adding a provider means one row, not a row plus a stray `it`.
13. As a maintainer, I want the postgres introspection flat key owned by its first test, so that only the URL literal doesn't justify a second one.
14. As a maintainer, I want "loads defineConfig projection from disk" removed, so that loading a config from disk is owned by the bootstrap-from-disk test and the direct-loader test, and no test leaks `MY_KEY`/`MY_DB` on failure.
15. As a maintainer, I want "defaults to postgres when no provider is configured" removed, so that the studio-execute default is owned by the test that actually reaches the default step.
16. As a reviewer, I want no production file and no export changed, so that the PR is reviewable as test-only.
17. As a reviewer, I want each removal traceable to its ledger row and keeper, so that I can confirm no unique input was lost.
18. As a release manager, I want an empty changeset, so that the required Changesets check passes without releasing any package.

## Implementation Decisions

Test names below are as they read at `2ff9332c`; line numbers in the issue's ledger match that commit but shift as rows are removed, so build finds tests by name.

- **Repair "2. mock SQL path" (F, decision 2).** Pass an `onResolve` that captures `modelSource`, keep the `result.sql` assertion, assert the captured value is `"mock"`, and replace the `createLanguageModelFromEnv` negative with `registry.resolveAiConfig` and `registry.createLanguageModel` `not.toHaveBeenCalled()`. The test keeps its preloaded schema and name.
- **Repair "3. model override" (F, decision 2).** Same capture and negatives, asserting `"override"`. The test keeps passing both `model` and `deps.generateText` (the stub stops the sentinel model from reaching a real provider call); the `modelSource` assertion is what tells the override path from the mock path.
- **Retire `client.hooks.test.ts` (C + D).** Delete the file. "onResolve hook fires with dialect and modelSource info" folds into "2. mock SQL path" through the assertion above; its `dialect.source` check is covered by the "4. dialect precedence" tests. "imports PreparedQuery / BoundQuery / bindPreparedQuery from @askdb/core and rebinds" is deleted; its remaining proof is core's "binds string/number/boolean/date/datetime for postgres" and "allocates one marker per repeated scalar occurrence" bind tests, and the consumer lab's `@askdb/core` barrel imports of `bindPreparedQuery` (`grade.ts`, `test/results.test.ts`). Not core's JSON round-trip test, which #507 deletes.
- **client.test.ts deletions (D).** Remove "1. schema from createAskDb({ schema: { path } }) - loads and uses the schema" (keeper: "7. caching - schema loaded once; reload() forces re-resolution"), "6. missing key - rejects when registry returns undefined model" and the providers describe's "builds the registry internally from providers" (keeper for both: "routes model resolution through the providers-built registry", backed by "registers every built-in provider…" and "accepts built-in provider names…").
- **config.test.ts consolidations (C).** "The compat table" below is the `compatibility` describe's `it.each` of exact flattened maps per provider; "the drift tests" are `provider-config-drift.test.ts`'s "the %s connection round-trips its API key, base URL, and default model through the provider" and "the %s language model reaches the provider". Remove "flattens postgres introspection databaseUrl to ASKDB_INTROSPECT_POSTGRES_URL" (keeper: "maps openai + mock rag + memory store", which asserts the same key from the same postgres branch), "flattens anthropic provider branch to correct env keys" and "flattens anthropic baseUrl when provided" (keepers: the compat table's "anthropic" row and the drift tests), "flattens gateway provider branch to AI_GATEWAY_API_KEY and the universal model/base URL keys" (keepers: the compat table's "gateway" row and the drift tests), "known providers are unaffected by the custom-provider branch" (keepers: the compat table's "openai" row and "prefers ai.language.model over a legacy provider model, and says the legacy one is ignored"), and the `ai.language.reasoning` describe's "emits no reasoning env keys when unset (preserves current behavior)" (keeper: the compat table's "openai" row, whose exact map has no reasoning keys). Keepers stay unchanged; nothing is carried over.
- **config.test.ts deletions (D).** Remove "loads defineConfig projection from disk" (keepers: "loads .env then installs runtime from nested askdb.config", which loads an openai/postgres `env()` config from disk through the bootstrap, and "the scaffolded %s ai block loads and reads every env var it lists", which calls the projection loader directly for every provider) and the `studio execute` describe's "defaults to postgres when no provider is configured" (keeper for the step-3 default: "falls back to postgres when introspection is prisma (schema-only provider)"; for the step-2 fallback: "falls back to introspection provider when no execute provider is set" and "falls back to introspection provider for sqlserver").
- **Leftovers.** Remove any import, fixture or helper that the removals leave unused in the edited files; the packages' `lint` type-checks only the build config, which excludes test files, so build checks this by reading. `makeConfig`'s unused params stay (decision 5).
- **No seams (decision 3).** No production export is added or removed.
- **One PR (decision 4).** Build may land it as a client commit and a config commit.
- **Changeset.** The required Changesets check counts any change under `packages/*/src/`, tests included, as publishable, so build adds an empty changeset (`pnpm changeset --empty`) as the repo does for test-only changes (`37753ea4`, `33ae9b01`). Test files are excluded from each package's build, so no published output changes.

## Testing Decisions

- A good test here checks the public seam: `createAskDb(...).ask()` and its `onResolve` hook for the facade, and the config loaders and flatten output for `@askdb/config`. The repairs stay at that seam and read the registry mock only to prove it wasn't consulted; no new seam is added.
- The repaired tests must fail for the regression they name. Build checks this once by hand and reverts before committing: move the `mockSql` short-circuit in the facade's model resolution below the registry call and see "2. mock SQL path" fail; swap the override and mock-deps checks and see "3. model override" fail on `modelSource`.
- Expected counts after the change: `@askdb/client` drops by exactly 5 tests (the 2 in the hooks file and 3 in `client.test.ts`); `@askdb/config` drops by exactly 8. `provider-config-drift.test.ts` and `@askdb/connectors` are unchanged.
- Confirm on the branch that every keeper named above still exists, unchanged, and passes, including core's two bind scalar tests and the consumer lab's `bindPreparedQuery` imports (the consumer-lab rebind test needs live engines, so build reports it as present, not run).
- Run the edited suites, then `pnpm test` and `pnpm lint` at the root.
- Prior art: the "4. dialect precedence" tests already capture `onResolve` the same way; the providers describe already asserts on a real providers-built registry.

## Out of Scope

- Folding the postgres/mysql/sqlite/sqlserver introspection flatten tests into one `it.each` table (the plan marks it optional).
- Removing `makeConfig`'s unused `schemaPath`, `schemaJson`, `envSchemaPath`, `envSchemaJson` params, and adding tests for the three coverage gaps the issue lists (default-schema resolution, registry model caching across asks, `studio.execute` non-boolean rejection): the plan calls them follow-ups, and this ticket doesn't file them.
- Removing `setAskDbRuntimeForTests` / `resetAskDbRuntimeForTests` (used in seven files outside this lane).
- The two minor observations in the issue (blank structured `outputDir`, the stale negatives' history): neither is a defect to fix here.
- Any production code change, and any test not named in the ledger rows.

## Ticket coverage

| Done when (acceptance criterion) | Met by |
| --- | --- |
| Issue: each F row repaired, its assertion can now fail | Repair "2. mock SQL path"; Repair "3. model override"; Testing Decisions (hand check); decision 2 |
| Issue: each C row consolidated into its keeper, with carry-over | Retire `client.hooks.test.ts`; config.test.ts consolidations; decisions 1 and 2 |
| Issue: each D row deleted, remaining proof still exists and passes | Retire `client.hooks.test.ts`; client.test.ts deletions; config.test.ts deletions; Testing Decisions (keeper check) |
| Issue: each test-only seam removed (none) | No seams; decision 3 |
| Issue: `pnpm test` green, `pnpm lint` passes | Testing Decisions |
| Triage: test 2 captures `onResolve`, asserts `"mock"` and the two registry negatives | Repair "2. mock SQL path" |
| Triage: test 3 asserts `"override"` and the same negatives | Repair "3. model override" |
| Triage: the repaired assertions can fail | Testing Decisions (hand check) |
| Triage: hooks file deleted; the 3 client and 8 config rows removed | Retire `client.hooks.test.ts`; client.test.ts and config.test.ts deletions and consolidations; expected counts |
| Triage: keepers named in the ledger still exist and pass | Testing Decisions (keeper check); Needs you (hooks rebind proof after #507) |
| Triage: `pnpm test` and `pnpm lint` pass | Testing Decisions |

## Further Notes

- The ticket passed the grill stage with no grilling record: triage listed no open decisions and took no defaults.
- Sibling campaign tickets (#507 core-sql, #510 core-ask, #514 postgres, #517 sqlserver) edit other packages' tests; only #507 touches a proof this ticket cites (see Needs you).
