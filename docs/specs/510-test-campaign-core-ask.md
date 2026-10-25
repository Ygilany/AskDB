# Spec: apply the core-ask test campaign plan (#510)

## For the owner

This spec applies the weekly test campaign's plan for `@askdb/core`'s ask pipeline tests: 4 weak tests repaired so they can fail for the regression their names describe, 4 redundant tests folded into named keepers, no production change.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Scope | Test files only; no production file, an empty changeset only, no test-only seam removed (the plan found none) | Campaign plan (issue body, Scope and Layer plan), verified at triage | Two-way: revert the PR |
| 2. Repairs (F) | Pipeline-mode test asserts one event logged before `generate`; providerOptions test renamed to what it asserts; log levels and mode ids pinned with exact strings | Campaign plan (Repairs), verified at triage against `ask.ts` | Two-way |
| 3. Folds (C) | Each redundant test removed, its distinct assertions carried into the named keeper | Campaign plan (Keepers per contract, Carry-over assertions), verified at triage | Two-way |
| 4. Product notes | The issue's possible bugs and coverage gaps stay out; filed separately if they hold | Campaign plan (Possible product bugs), triage Agent Brief Out of scope | Two-way |

```text
ask.test.ts                       :65  F  mode logged once, before generate      (repair)
                                  :83  F  rename to "leaves ... undefined"       (repair)
                                  :710 C  ──folds into──▶ :1282                  (delete)
logging/log-contract.test.ts      :5   C  ──folds into──▶ create-askdb-logger    (delete file)
logging/pino-supported-levels     :10  C  ──folds into──▶ :23                    (delete)
                                  :23  F  exact sorted list                      (repair)
modes/types.test.ts               :26  F  exact "schema_only|bounded_results"    (repair)
retrieval/synthesize-ddl.test.ts  :70  C  ──folds into──▶ :14                    (delete)
```

**Risks:** the files sit under the manifest's sensitive paths (`logging/`, `retrieval/`, `ask.ts`), so an edit that touches a production file there by accident would be easy to miss; the review checks the diff is test-only. The exact log-level string fails if a Pino upgrade adds a default level, which is the intent, since the list is user-facing CLI text.

**Done when:** the 9 acceptance rows of the triage brief hold (table at the end), `pnpm test` and `pnpm lint` pass, and the PR shows each repaired assertion failing against a deliberate break.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

Maintainers rely on `@askdb/core`'s unit tests to catch regressions in the ask pipeline, its logging and its mode parsing. The test campaign found four tests whose names promise a contract their assertions don't check: the pipeline-mode event's ordering before generation, the absence of a providerOptions key, the sorted order of supported log levels, and the pipe separator in mode help text. Each passes whether or not the behavior it names holds. It also found four tests that repeat a contract a stronger test in the same subsystem already owns, which costs reading time and gives a false sense of extra coverage. One of them (`log-contract.test.ts`) pins the required-fields constant to an exact list, against its own module's note that consumers tolerate additive fields.

## Solution

Each weak test keeps its name's contract and gains an assertion that fails when that contract breaks, or, for the providerOptions test, is renamed to say what it does assert. Each redundant test is deleted after its distinct assertions move into the keeper the plan names, so every contract keeps exactly one owner in this subsystem and no contract loses coverage. No production code, public API or package output changes.

## User Stories

1. As a maintainer, I want the pipeline-mode logging test to fail when the `PipelineMode` event moves after SQL generation, so that the documented "emitted before NL→SQL" ordering is enforced.
2. As a maintainer, I want the pipeline-mode logging test to fail when the event is logged twice, so that duplicate log lines are caught.
3. As a CLI user reading `--log-level` errors, I want the supported levels list pinned exactly, so that a change in its order or content is a reviewed change.
4. As a CLI user reading help text, I want the modes list pinned to `schema_only|bounded_results`, so that a separator change is caught.
5. As a maintainer, I want the providerOptions passthrough test named for what it asserts, so that nobody reads it as proof that no key is forwarded.
6. As a maintainer, I want the custom-dialect passthrough contract owned by one test, so that I read and update one place when it changes.
7. As a maintainer, I want the required log fields checked on a real emitted log line rather than against a copied list, so that the test proves the logger writes them.
8. As a maintainer, I want a shrink of `ASKDB_LOG_REQUIRED_FIELDS` to still fail in core, so that the CLI's end-to-end log test, which reads that constant, is not silently weakened.
9. As a maintainer, I want an additive field in `ASKDB_LOG_REQUIRED_FIELDS` not to fail core's tests, so that the test matches the log contract's "tolerate additive fields" rule.
10. As a maintainer, I want the tenant-policy DDL test to cover two chunks, so that "only the first tenant-policy chunk rendered" is still caught after the duplicate test goes.
11. As a reviewer, I want the PR to show each repaired assertion failing against a deliberate break, so that I can trust the repair without re-running the experiment.
12. As a reviewer, I want the diff to touch only test files, so that a test campaign can't change pipeline behavior.
13. As the campaign's next run, I want the subsystem's ledger to have no F or C rows from this plan left, so that the next audit starts clean.

## Implementation Decisions

All of these come from the campaign plan in the issue body, verified by triage against the code at `2ff9332c`.

- **Pipeline-mode ordering (repair).** The test drives `ask()` with a custom dialect whose `generate` records how many `info` calls the logger has received at that moment. It asserts exactly one call carries the `PipelineMode` event, that this call's index is below the recorded count, and that it carries `mode: "bounded_results"` as it does today. The production emit point and the generation call stay where they are.
- **providerOptions passthrough (repair by rename).** `ask()` always forwards a `providerOptions` key, set to `undefined` when `deps.providerOptions` is unset. The test is renamed to "leaves options.providerOptions undefined when deps.providerOptions is unset" and its assertion stays. The "no key reaches `generateText`" contract belongs to the core-sql lane's generate tests, not this one.
- **Custom-dialect passthrough (fold).** "custom AskDialect is unaffected and returns no extras" is deleted. Its keeper, "without a tenant policy, custom dialect output is unchanged", already asserts the whole result equals `{ sql }`, which is strictly stronger. Nothing carries over.
- **Required log fields (fold).** `log-contract.test.ts` is deleted. The logger test that writes a real JSON line to a file sink gains two assertions: every field named in `ASKDB_LOG_REQUIRED_FIELDS` is present and truthy on that line, and the constant contains at least `event` and `correlationId` (an `arrayContaining` match, so additive fields pass and a shrink fails). Its existing exact checks on `correlationId` and `event` stay.
- **Supported log levels (fold and repair).** "includes every default Pino numeric level plus silent" is deleted; its expected values came from the same expression as the implementation. "formatSupportedAskDbLogLevels lists sorted names" asserts the exact string `debug, error, fatal, info, silent, trace, warn`, which pins every level, `silent`, the order and the separator with literal values. The other test in that file stays.
- **Mode ids for help text (repair).** "lists pipe-separated ids for help text" asserts the exact string `schema_only|bounded_results`.
- **Tenant-policy chunks in retrieved DDL (fold).** "includes multiple tenant-policy chunks" is deleted. The first tenant-policy test gains a second `tenant-policy` chunk with id `chunk:tenant-policy#scope-rules` in its results and asserts the DDL contains that chunk's text, alongside its existing assertions on the first chunk, the section header and the table.
- **Production code.** None changes. No test-only production seam is removed: the plan found every export the subsystem's tests touch has a non-test caller or is public API. `SuggestEnrichmentDeps.generateText` has no non-test caller but is public API, so removing it is out of scope.
- **Release.** An empty changeset (`pnpm changeset --empty`), no version bump: no publishable package's output changes, but the `changesets` workflow's `status` check counts any file under `packages/*/src`, test files included, as a publishable change and fails without one.

## Testing Decisions

- A good test here fails for the regression its name describes and passes otherwise; it asserts the public output of `ask()`, the logger, the format helpers and `synthesizeRetrievedDdl`, not their internals. Expected values are literals, never recomputed from the implementation's own expression.
- The modules under test are unchanged: `ask()` through its injected dialect and logger, `createAskDbLogger` through a file sink, the log-level and mode format helpers, and `synthesizeRetrievedDdl` with schema fixtures. No new seam is added; every test uses one that already exists.
- Prior art: the keeper tests named above, and the existing capturing-dialect pattern in the providerOptions tests of the same file.
- Each repaired assertion is shown able to fail: build temporarily breaks the behavior (for example, logs the mode event after generation or twice, changes the sort or the separator, drops a field from a log line, renders only the first tenant-policy chunk), runs the test, sees it fail, and restores. The PR body records each break and its failure; none of the breaks is committed.
- `pnpm test` and `pnpm lint` pass. The subsystem's test count drops from 90 to 86 by design (four folds); the brief's "test count does not drop" reads as the count of contracts covered, which stays the same.

## Out of Scope

- Any production change, including moving the `PipelineMode` emit point or the providerOptions forwarding.
- Removing `SuggestEnrichmentDeps.generateText` (public API; a breaking change).
- The issue's low-confidence discrepancies: the review profile's wording on enrichment prompts and sensitive fields, `parseAskDbModeV1(" ")` throwing where `""` defaults, and the logger test's temp dir inside the source tree. Each is filed separately if it holds.
- The coverage gaps the campaign noticed: the retriever's `schema_not_v2` skip, and `synthesizeRetrievedDdl`'s omit-sensitive branch and column, concept, relationship and question rendering.
- Changes to the CLI's spawn-logs test, which stays the end-to-end keeper for the log constants.
- A changeset that bumps a package version.

## Further Notes

- The grill stage was skipped (no open decisions), so the decisions above come from the campaign plan in the issue body and triage's verification of it; triage took no defaults.
- The plan's size estimate is about 95 changed lines across 6 files (one deleted, five edited).

### Ticket coverage

| Done when (triage brief acceptance criteria) | Met by |
| --- | --- |
| `ask.test.ts` "emits pipeline mode before generation" asserts exactly one `PipelineMode` event logged before `generate` runs | Decision 2; Implementation Decisions, Pipeline-mode ordering |
| "does not forward a providerOptions key…" renamed to "leaves options.providerOptions undefined when deps.providerOptions is unset" | Decision 2; providerOptions passthrough |
| "custom AskDialect is unaffected and returns no extras" deleted; the tenant-policy-less custom dialect test stays | Decision 3; Custom-dialect passthrough |
| `log-contract.test.ts` deleted; the logger test carries the field loop and the `arrayContaining` check | Decision 3; Required log fields |
| "includes every default Pino level" deleted; the sorted-names test uses an exact `toBe` on the full list | Decisions 2 and 3; Supported log levels |
| Modes pipe-separated test uses an exact `toBe("schema_only\|bounded_results")` | Decision 2; Mode ids for help text |
| "includes multiple tenant-policy chunks" deleted; the first test carries a `chunk:tenant-policy#scope-rules` chunk and a `toContain` on its text | Decision 3; Tenant-policy chunks |
| No production file changes; `pnpm test` and `pnpm lint` pass | Decision 1; Production code; Testing Decisions |
| Each repaired assertion shown able to fail | Testing Decisions, deliberate-break check recorded in the PR body |
| Issue rows: each D row deleted; each unlocked test-only seam removed | None in the plan (D 0, no seams); Production code |
