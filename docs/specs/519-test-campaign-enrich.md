# Spec: apply the enrich test campaign's plan (#519)

## For the owner

This spec repairs three `@askdb/enrich` tests so each fails for the bug it names, folds two redundant ones into the tests that already own their contract, and adds one row to core's mention table, changing test files only.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| D1. Where the new `["Open the café", "caf", false]` mention row lands | In core's `findMentionedNames` table, in this ticket, once; skipped (and said so in the PR) if #518 or another ticket has added it first | default D1 (triage) | Two-way: delete the row |

```text
packages/enrich/src/draft.test.ts
  [repair]  buildFrontmatter omits empty optional fields      → empty inputs, not absent ones
  [shrink]  findSensitiveColumnReferences … (4 rows)           → 1 row (ssn$), renamed "delegates to core"
packages/enrich/src/workspace.test.ts
  [delete]  loadWorkspace pairs physical tables with markdown  → id pairing stays proven by "keeps existing filenames stable"
  [repair]  saveTable updates description and re-parses        → + assert the in-memory parse
  [repair]  validates and saves concept links                  → + saveConcepts refuses a dangling link
packages/core/src/schema/v2/mentions.test.ts
  [+1 row]  ["Open the café", "caf", false]                    → D1
no production file changes
```

**Risks:** the core row sits under the sensitive path `packages/core/src/schema/**` (a test file only). #518 (rag campaign) proposes the same row, so whichever lands second must skip it.

**Done when:** each repaired test fails when its guard is removed and passes with it; the two folded tests are gone and their keepers pass; the café row is in core's table exactly once; `pnpm test` and `pnpm lint` pass and no production file changes.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited `@askdb/enrich`'s 42 test declarations at `2ff9332c` and found five that give false comfort. Three pass even when the production guard they name is deleted, so a regression in that guard ships green. Two replay a contract another test already owns, so they cost upkeep without adding proof. A maintainer reading the suite cannot trust that a green run means `buildFrontmatter`, `saveTable` and `saveConcepts` still behave as their tests' names promise.

## Solution

The three weak tests are changed so their inputs and assertions reach the guard they name; the two redundant ones are removed or cut down to what only enrich can prove, and the one row they held that core lacked moves into core's shared table. After this, deleting any of the named guards turns the enrich suite red, and each contract has one owner test.

## User Stories

1. As a maintainer, I want `buildFrontmatter`'s "omits empty optional fields" test to fail when the empty-list and empty-string guards are removed, so that a regression that writes `aliases: []` or `description: ""` into table front-matter is caught.
2. As a Studio user who clears a list field, I want the cleared field left out of the saved file, so that my table front-matter stays minimal; the repaired test proves what Studio sends (`[]` and `""`) is dropped.
3. As a maintainer, I want the `saveTable` test to check the workspace held in memory after a save, so that removing the re-parse step fails a test even though Studio reloads after every save.
4. As a host that keeps a `Workspace` across saves, I want `saveTable` to leave the in-memory parse matching the file, so that a later edit or `pruneOrphanedColumns` sees the saved state.
5. As a maintainer, I want a test that calls `saveConcepts` with a dangling link and expects it to throw, so that dropping the guard Studio's concepts endpoint relies on fails the suite.
6. As a Studio user, I want a concept that links to a missing table refused without touching `concepts.md`, so that a bad save never corrupts the file.
7. As a maintainer, I want the name-pairing test that cannot tell id pairing from name pairing removed, so that the suite keeps the one test that does prove id pairing and drops the one that only looks like it does.
8. As a maintainer, I want enrich's sensitive-reference test to keep one row proving it delegates to core's mention rule, so that the mention rule itself is tested in one place, core's table.
9. As a maintainer of core's mention rule, I want the "name followed by a non-ASCII letter" case in core's table, so that the one case enrich covered and core did not is not lost when enrich's copy shrinks.
10. As a reviewer, I want the diff to touch test files only, so that the change carries no product risk and needs no changeset.

## Implementation Decisions

- **Scope is the campaign's plan, as triage verified it.** Every change below is one the issue's ledger rows and layer plan name; triage confirmed each against the code at `2ff9332c`. Nothing outside those rows changes.
- **`buildFrontmatter omits empty optional fields` (repair).** Build the draft as today, then set it to empty rather than absent values: table `aliases: []`, `tags: []`, `primaryEntity: ""`, and one column's draft `{ aliases: [], enum: [], description: "" }`. Keep the existing assertions (table `aliases`, `primaryEntity`, `tags`, `sensitive` and `columns` all undefined). The guards this makes reachable are the `nonEmptyStrings` checks on table and column lists, the column description's empty-string check and the `primaryEntity` truthiness check in `buildFrontmatter`.
- **`findSensitiveColumnReferences uses core's mention rule` (shrink).** Keep only the `ssn$` row, which a local `\b` regex would fail, as proof that enrich delegates to core. Rename the test to say what it now proves, e.g. "findSensitiveColumnReferences delegates to core's mention rule". The `CAFÉ` and `cafés` rows are already in core's table; the `caf`/`café` row moves there (next bullet). The neighbouring sensitive-only filter tests stay.
- **Core's `findMentionedNames` table (+1 row, D1).** Add `["Open the café", "caf", false]` to the table once. Before adding it, check whether it (or an equivalent "name followed by a non-ASCII letter is not a mention" row) is already there; if so, add nothing and say so in the PR.
- **`loadWorkspace pairs physical tables with markdown by id` (delete).** Remove the whole test; nothing carries over. What it appeared to cover stays covered: id pairing by "keeps existing filenames stable" (a file named `Custom Name.md` pairs to `table:archive.orders`), `parsed` pairing by the `saveTable` test and the sensitivity round-trip test (both dereference `orders.parsed`), and `ws.physical.schemaId` by Studio's `server.test.ts`, which reads it through `/api/workspace`. (The ledger also cites the sensitivity round-trip test for `schemaId`, but that test passes the literal `"orders-users"`; Studio's test is the coverage that holds.)
- **`saveTable updates description and re-parses to the saved state` (repair).** After `saveTable`, also assert that the same workspace's `orders.parsed.body` contains the updated description. Keep the on-disk and reload assertions.
- **`validates and saves concept links against table and column ids` (repair).** Read `concepts.md` before the call, assert that `saveConcepts` with a concept linking to a missing table throws `/Invalid concept link/`, then assert `concepts.md` is byte-for-byte unchanged. The fixture ships a `concepts.md`, so "unchanged" compares contents. Keep the existing valid-save assertions.
- **`modeWhenGroupLost` keeps its test-only export.** The plan judged that moving its rows to the `saveTable` boundary would make the rule's tests depend on the host having a second group; the seam is not unlocked.
- **No changeset.** Only test files change, so no published package's output moves.

## Testing Decisions

- **A good test here fails for the regression its name promises and tests behaviour through the public functions** (`buildTableDraft`, `buildFrontmatter`, `saveTable`, `saveConcepts`, `loadWorkspace`, `findSensitiveColumnReferences`, and core's `findMentionedNames`). No new seams: every repair uses a function the tests already call.
- **Each repair is proven by mutation, by hand, before commit.** Remove the guard, run the test, see it fail, restore the guard: the `nonEmptyStrings` / empty-string checks in `buildFrontmatter`, the in-memory re-parse assignment in `saveTable`, and the invalid-link check in `saveConcepts`. The PR body records the result; the mutations are never committed.
- **Modules tested:** `packages/enrich` (`draft.test.ts`, `workspace.test.ts`) and core's mention table (`mentions.test.ts`). `workspace-ownership.test.ts` is unchanged.
- **Prior art:** core's `findMentionedNames` `it.each` table for the new row's shape; the existing `saveTable` and concept tests' fixture setup (a copy of `fixtures/schemas/orders-users.schema` in a temp directory) for the repairs.
- **Gate:** each new or changed test passes `factory-test-audit`'s authoring gate; `pnpm test` and `pnpm lint` pass.

## Ticket coverage

| Ticket acceptance item | Met by |
| --- | --- |
| Each `F` row is repaired and can now fail for the regression it names | Implementation Decisions: the three repairs; Testing Decisions: mutation check |
| Each `C` row is consolidated into its keeper, with the assertions the plan carries over | Implementation Decisions: the shrink, the delete, and the core row (D1) |
| Each `D` row is deleted and its remaining proof passes | None in the plan (D 0) |
| Each test-only seam the plan unlocks is removed (none, if the plan says none) | Implementation Decisions: `modeWhenGroupLost` keeps its export |
| `pnpm test` green and `pnpm lint` passes | Testing Decisions: gate |
| Row `draft.test.ts:98` (F) | `buildFrontmatter` repair |
| Row `draft.test.ts:118` (C) | `findSensitiveColumnReferences` shrink + core row (D1) |
| Row `workspace.test.ts:64` (C) | `loadWorkspace pairs …` delete |
| Row `workspace.test.ts:74` (F) | `saveTable` repair |
| Row `workspace.test.ts:162` (F) | concept-link repair |
| Triage: no production file changes; no changeset | Implementation Decisions: scope, no changeset |

## Out of Scope

- **Any production change**, including removing the `modeWhenGroupLost` export or the public draft helpers that have no non-test callers.
- **A new `suggest.ts` test.** It has no test in any lane; that coverage gap is a follow-up, not this plan's budget.
- **The Studio overlaps** (`server.test.ts` replaying enrich's front-matter and write-error tests): the studio lane (#522) judges those.
- **The four possible product bugs** the campaign noted: `saveConcepts` writing through symbolic links, the stale "Studio's authoring warning" claim, the dead public draft helpers, and `isEnumCandidate` accepting array types. Each is filed as its own issue if it reproduces; none changes this ticket.

## Further Notes

- The campaign's baseline was green at `2ff9332c` (38/38 turbo tasks), with every `integrationSuite`-gated describe in `workspace.test.ts` running on the host.
- Expected size: about 25 changed lines across 3 test files.
