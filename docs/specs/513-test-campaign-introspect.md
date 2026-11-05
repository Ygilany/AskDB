# Spec: apply the `introspect` test-campaign plan (#513)

## For the owner

This spec applies the weekly test campaign's plan for `@askdb/introspect` and `@askdb/prisma` in one PR: it repairs 2 tests that can't fail for the bug they name, folds 8 redundant tests into the tests that already own their contract, and drops the `export` on `isModuleResolutionFailure`, which only tests used.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| D1. Ticket scope | One ticket and one PR for both packages, not the issue's suggested split into an `@askdb/introspect` ticket and an `@askdb/prisma` ticket | default D1 (triage) | Two-way: revert the PR |
| D2. The plan's two optional "move only" edits | Skipped: the standalone `introspect()` provider-forwarding test stays where it is, and the `runtimeIntrospectionString` describe stays in the registry tests | default D2 (triage) | Two-way: a later ticket can move them |

```text
tests touched                              production code touched
──────────────────────────────────         ─────────────────────────────
introspect.test.ts   [F] warning merge     kit/driver.ts
prisma.test.ts       [F] + snapshot          isModuleResolutionFailure:
registry.test.ts     [C] L58 → dispatch        `export` dropped, body unchanged
kit/driver.test.ts   [C] 5 predicate tests
                         → 1 loader it.each
kit/provider.test.ts [C] blank url → registry
prisma/provider.test.ts [C] blank path → registry
```

**Risks:** low. A consolidated row could test less than the predicate test it replaces; the carry-over list below names every row, and the builder checks each one maps to an old assertion. The changeset releases a patch of both packages with no behavior change.

**Done when:** both F tests fail under their named mutation and pass without it; the 8 C tests are gone with their assertions in the named keepers; `isModuleResolutionFailure` is not exported; one changeset covers both packages; `pnpm test` and `pnpm lint` pass.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change. You can veto D1 or D2 by name.

## Problem Statement

The weekly test campaign audited the `introspect` subsystem's 74 test declarations (head `2ff9332c`) and marked 64 as fine (R), 2 as weak (F) and 8 as redundant (C). The two weak tests pass even when the code they name is broken: the `introspect()` warning-merge test never makes the render emit a warning, so it can't catch the merge dropping render warnings, and the Prisma Connector snapshot leaves out `provider`, so the Prisma datasource-to-dialect mapping has no proof in its own package. The eight redundant tests replay a contract another test already owns: a third registry dispatch check, two blank-value checks that only replay the registry's shared blank-value handling through one adapter, and five tests of `isModuleResolutionFailure`, a function exported only so tests could call it. Contributors pay for redundant tests on every change to those contracts, and the weak ones give false confidence.

## Solution

After this change, each contract in the subsystem is proved once, at the layer that owns it. The warning-merge test seeds an existing artifact so both warning sources show up, and fails if either is dropped. The Prisma Connector snapshot includes `"provider": "postgres"`, so a broken dialect mapping changes it. Registry dispatch is checked once, with a full config. Blank explicit values are checked once, in the registry. Error classification for optional drivers is checked through the public `createOptionalDriverLoader`, the way engines use it, so the predicate no longer needs to be exported. Users of the published packages see no change.

## User Stories

1. As an AskDB contributor, I want the `introspect()` warning-merge test to fail when render warnings are dropped, so that a regression in the merge can't ship green.
2. As an AskDB contributor, I want the warning-merge test to pin the order (connector warnings first, then render warnings), so that a change to that order is a deliberate test update.
3. As an AskDB contributor, I want the Prisma Connector snapshot to carry `provider`, so that a broken Prisma-to-dialect mapping shows up in `@askdb/prisma`'s own tests and not only in the CLI spawn test.
4. As an AskDB contributor, I want registry dispatch checked in one test that passes a full config by identity, so that I update one test, not three, when dispatch changes.
5. As an AskDB contributor, I want blank explicit connection values checked once, in the registry tests, so that adapters' tests cover only what each adapter adds.
6. As an AskDB contributor, I want the driver loader's not-found vs real-failure behavior proved through `createOptionalDriverLoader`, so that the tests check what engines actually see (`missingMessage` or a `failed to load:` error with its `cause`).
7. As an AskDB contributor, I want every predicate case that existed before kept as a loader row, so that the consolidation doesn't lose coverage of nested causes, subpath specifiers, Yarn PnP wording, name-prefix packages or paths containing the name.
8. As an AskDB contributor, I want the loader rows to use fake package names, so that a real `pg` or `mssql` in some `node_modules` above the temp directory can't satisfy the project fallback and turn a row green by accident.
9. As an AskDB maintainer, I want `isModuleResolutionFailure` unexported, so that `kit/driver.ts` exposes only what the kit's public index lists.
10. As an AskDB maintainer, I want the change released through a changeset, so that the Changesets CI check passes and the release notes say the packages' behavior didn't change.
11. As a host app developer using `@askdb/introspect` or `@askdb/prisma`, I want no behavior or public API change, so that upgrading to the patch is a no-op for me.
12. As an AskDB maintainer, I want the campaign's checklist rows ticked one to one against the PR, so that I can see each F and C row was handled.

## Implementation Decisions

### F repairs

- **`introspect()` warning merge** (`introspect.test.ts`, "merges connector and render warnings"). Before calling `introspect()`, write a `schema.json` into a directory the test creates, holding a valid Schema v2 artifact with `tables: []` (version 2, schemaId `fake`), and pass that directory as `existingArtifactDir` in the render options. The render then reports the fake schema's one column as new. Expect `result.warnings` to equal, in this order, the connector's `{ code: "ambiguous_filter", filter: "public.missing" }` then the render's `{ code: "new_column", id: "table:public.users#id", tableId: "table:public.users" }`. The test keeps its name.
- **Prisma Connector contract** (`prisma.test.ts`, "wires through the Connector contract and renders Schema v2 JSON"). Pass `result.provider` as the third argument of `toV2SchemaJson`, and update the stored snapshot so it gains `"provider": "postgres"`. Regenerate the snapshot with vitest's update flag on this one file, and check that the snapshot diff contains only the added `provider` line.

### C consolidations

```text
retired test                                         keeper (gains)
──────────────────────────────────────────────       ──────────────────────────────────────────
registry: "passes all config fields through"   ───▶  registry: "dispatches to the correct adapter
                                                       by provider (object-map form)"
                                                       (full config, toHaveBeenCalledWith(config))
kit/provider: "treats a blank explicit value   ───▶  registry: "resolveConnection drops blank
  as absent…"                                          explicit values…" (already covers it)
prisma/provider: "falls back to the configured ───▶  same registry test (already covers schemaPath "\t")
  schema path when --prisma-schema is blank"
kit/driver: describe("isModuleResolutionFailure")───▶ kit/driver: new it.each inside
  (5 tests)                                           describe("createOptionalDriverLoader")
```

- **Registry dispatch.** Delete "passes all config fields through to the adapter". In "dispatches to the correct adapter by provider (object-map form)", call `createConnector` with a full `ConnectorConfig` (`provider: "mysql"`, `url`, `fromExport`, `filters`, `schemaId`) and replace the bare `toHaveBeenCalled()` with `toHaveBeenCalledWith(config)`; keep the assertion that the postgres adapter was not called.
- **Blank explicit values.** Delete the kit provider test "treats a blank explicit value as absent, so the configured connection applies" and the Prisma provider test "falls back to the configured schema path when --prisma-schema is blank". Neither adapter handles blanks itself; the registry's "resolveConnection drops blank explicit values before the adapter hook sees them" already covers `url`, `fromExport` and `schemaPath` with `"  "`, `""` and `"\t"`, and the kit test "resolveConnection prefers --url…" already proves that an absent `url` falls back to config. Add nothing.
- **Driver error classification.** Delete `describe("isModuleResolutionFailure")` and its 5 tests. Inside `describe("createOptionalDriverLoader")`, add one `it.each` whose rows give the error `importDriver` throws, an optional `specifier`, and whether it should count as "not found". Each row builds a loader with the fake `PKG` (`askdb-kit-fake-driver`), `missingMessage: "install it"` and the row's `specifier`, and calls `load({ resolveFrom: <empty temp project> })`. A match row expects an `AskDbError` whose `message` is exactly the `missingMessage`. A no-match row expects the message `` The optional `<PKG>` peer dependency failed to load: <detail> `` (where `<detail>` is the thrown error's message, or `String(thrown)` for a non-Error) and `cause` identical to what was thrown. Rows, each mapped to the old assertion it carries:

| Row | Thrown by `importDriver` | `specifier` | Expect | Carries |
| --- | --- | --- | --- | --- |
| own not-found | `ERR_MODULE_NOT_FOUND`, `Cannot find package '<PKG>'` | none | match | old L42 |
| nested cause | `Error("wrapper", { cause: <own not-found> })` | none | match | old L45 |
| subpath entry point | `MODULE_NOT_FOUND`, `Cannot find module '<PKG>/promise'` | `<PKG>/promise` | match | old L55 (`mysql2/promise`) |
| Yarn PnP, exact | `MODULE_NOT_FOUND`, `…tried to access <PKG>, but it isn't declared…` | none | match | old L76 |
| other package | `ERR_MODULE_NOT_FOUND`, `Cannot find package '<another fake name>'` | none | no match | old L43 |
| name-prefix package | `ERR_MODULE_NOT_FOUND`, `Cannot find package '<PKG>-connection-string'` | none | no match | old L60 |
| path containing the name | `MODULE_NOT_FOUND`, `Cannot find module '/home/<PKG>user/app/db.js'` | none | no match | old L64 |
| Yarn PnP, near-miss | `MODULE_NOT_FOUND`, `…tried to access <PKG>-connection-string, …` | none | no match | old L77 |
| generic error naming the package | `Error("boom <PKG>")`, no code | none | no match | old L44 |
| non-Error throw | the string `"not an error"` | none | no match | old L46 |

  The old `pg/lib/missing` case (old L56) needs no row: "reports an installed driver missing its own file, found through the engine's import" already proves it at the loader. Match rows reach the project fallback, which fails to resolve the fake name from the empty temp project, so they end in `missingMessage`; that is why every name must be fake. Build the errors with small local helpers in the test file (the existing `notFound` helper, plus ones for the CommonJS and PnP wordings), not inline objects repeated per row.

### Test-only seam

- **`isModuleResolutionFailure`.** Remove the `export` keyword in `packages/introspect/src/kit/driver.ts`. Its body and doc comment stay as they are, and its only callers are inside that file. It was never reachable by package consumers: the package `exports` map lists only `.` and `./kit`, and the kit index doesn't re-export it. After the change, nothing outside `driver.ts` names it (`grep` over `packages/` and `apps/` finds only that file).

### Changeset

- One changeset, `patch` for both `@askdb/introspect` and `@askdb/prisma`. It says the change is internal: tests consolidated, the unreachable `isModuleResolutionFailure` export dropped, and no behavior or public API change. The Changesets workflow requires a changeset for any change under `packages/*/src`, tests included.

### Not touched

- No other production code changes. No docs-site page changes: no public API, CLI flag or integration pattern changes, and no docs page mentions `isModuleResolutionFailure`.

## Testing Decisions

- **A good test here** checks behavior a caller can see: `introspect()`'s returned warnings, the rendered Schema v2 JSON, the registry's calls to an adapter, and the loader's thrown `AskDbError` message and `cause`. It doesn't check private helpers. That is the reason the predicate tests move to the loader.
- **Mutation check for the F repairs.** The builder confirms each repaired test can fail by applying its mutation locally, seeing the test fail, and reverting:
  - in `introspect()`, return `warnings: result.warnings` (render warnings dropped): the warning-merge test must fail;
  - in the Prisma connector, change the `postgresql` branch of the dialect mapping (or drop `provider` from the describe result): the Connector snapshot test must fail.
  Record both results in the PR body. Neither mutation is committed.
- **Coverage check for the consolidation.** Every row of the carry-over table above is present in the new `it.each`, and each old predicate assertion maps to a row or to the existing loader test named for `pg/lib/missing`. The PR body lists the mapping.
- **Prior art:** the existing `createOptionalDriverLoader` tests use the same `tempProject(false)` setup and assertions on the error's `message` and `cause`. `it.each` tables are already used in `registry.test.ts` and `kit/label.test.ts`.
- **Modules tested:** `@askdb/introspect` (`introspect()`, `createConnectorRegistry`, `createOptionalDriverLoader`, `defineLiveConnectorProvider`) and `@askdb/prisma` (`createPrismaConnector`, `prismaConnectorProvider`). Every new or changed test goes through the `factory-test-audit` gate.
- **Suite checks:** `pnpm test` and `pnpm lint` pass. Declarations drop by 7 (8 retired, 1 `it.each` added); runtime cases change by +2 (8 retired, 10 loader rows added).

## Ticket coverage

| Ticket item (issue's Acceptance criteria and Rows, triage brief) | Met by |
| --- | --- |
| Each F row repaired; its assertion can now fail for the regression it names | Implementation Decisions: F repairs; Testing Decisions: mutation check |
| Row: introspect.test.ts, merges connector and render warnings (F) | F repairs: `introspect()` warning merge |
| Row: prisma.test.ts, wires through the Connector contract (F) | F repairs: Prisma Connector contract |
| Each C row consolidated into its named keeper, with the carry-over assertions | Implementation Decisions: C consolidations |
| Row: registry.test.ts, passes all config fields through (C) | C consolidations: Registry dispatch |
| Rows: kit/driver.test.ts, 5 `isModuleResolutionFailure` tests (C) | C consolidations: Driver error classification, carry-over table |
| Row: kit/provider.test.ts, blank explicit value (C) | C consolidations: Blank explicit values |
| Row: prisma/provider.test.ts, blank `--prisma-schema` (C) | C consolidations: Blank explicit values |
| Each D row deleted (the plan has none) | Nothing to do: no D rows |
| Each test-only production seam the plan unlocks removed | Implementation Decisions: Test-only seam |
| A changeset covers `@askdb/introspect` and `@askdb/prisma` (triage) | Implementation Decisions: Changeset |
| `pnpm test` and `pnpm lint` pass | Testing Decisions: suite checks |
| One PR, not split | Decision D1 |
| Optional move-only edits | Decision D2 (skipped) |

## Out of Scope

- **The product gaps the campaign noted:** no test of the Prisma dialect mapping for `mysql`, `sqlite`, `sqlserver` or `cockroachdb`; no test of `introspect()` keeping a caller's `renderOptions.provider`; the low-confidence observation that Prisma enums always land in `public`. Each needs its own issue if it holds up.
- **`compileGlob`'s dead export** in the kit's filters module: it isn't used by tests, so it isn't a test-only seam. It belongs in a hygiene follow-up.
- **The optional move-only edits** (D2).
- **The dialect `*.lazy.test.ts` cwd-default copies** in the postgres, mysql, sqlite and sqlserver campaign tickets. They retire in those tickets once `kit/driver.test.ts` has a cwd case (the sqlite ticket's plan adds it).
- **The multi-engine fixture's own test**, all R rows.

## Further Notes

- The campaign's line numbers (L21, L58 and so on) refer to head `2ff9332c`; this spec names tests by their titles, which survive line shifts.
- The issue's size estimate is about 120 changed lines in 9 files, counting the snapshot and the changeset. That is within the standard lane's budget.
