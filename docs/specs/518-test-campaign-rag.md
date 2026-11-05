# Spec: apply the `@askdb/rag` test-campaign ledger (#518)

## For the owner

This spec applies the nine-row ledger the weekly test campaign left for `@askdb/rag`: three tests repaired so they can fail for the regression they name, two folded into their keepers, four deleted with their keepers still passing, one mention-rule row moved into core, and an empty changeset. Test files only; no production code changes.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| D1. pgvector integration repair shape | Keep step 1 and make it write a real lock through a non-ephemeral store (A), so the real-database test covers "matching lock, empty table"; not "drop step 1 and rename" (B) | default D1 (triage) | Two-way: revert the test file |

```text
packages/rag/src
├── chunker/chunker.test.ts         F  long-body split: exact #bc:1..N ids + whole paragraphs
│                                   C  "emits tenant-policy chunks" → byType line moves into "one chunk per H2 section"
│                                   D  "not sensitive by default", "deterministic across runs"
│                                   C  mention-rule it.each → deleted; 1 row moves to core ──┐
├── indexer/index.test.ts           D  "lock-file hash ordering", "(process restart)"          │
├── stores/pgvector.test.ts         F  no-width store: upsert resolves, one INSERT              │
└── stores/pgvector.integration…    F  step 1 writes a real lock (D1)                           │
packages/core/src/schema/v2/mentions.test.ts   + ["open the café", "caf", false]  ◀─────────────┘
.changeset/                          + empty changeset
```

**Risks:** the core row is also proposed by the enrich campaign (#519); whichever lands second skips it. The integration repair only runs where `ASKDB_PGVECTOR_URL` is set (CI's `test` job), so a local run proves only that it type-checks.

**Done when:** every row of the issue's checklist is applied as the Ticket coverage table below says; each repaired test fails when its named regression is introduced; `pnpm test` and `pnpm lint` pass; an empty changeset is present.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change (`/changes D1 B` picks the drop-and-rename repair).

## Problem Statement

The weekly test campaign (issue #518, head `2ff9332c`) audited `@askdb/rag`'s 104 test declarations and marked nine. Three tests pass for the wrong reason: the long-body splitting test would pass a splitter that slices on characters, the pgvector unit test named for writes asserts none, and the pgvector integration test named for "a committed lock" never writes a lock, because step 1 indexes into a memory store, which has been ephemeral (lock neither read nor written) since `7a0f777d`. Six more tests repeat what a stronger keeper already proves, so a maintainer reading a failure or changing the chunker has more to read and nothing more caught. Triage checked each row against current `main` and found the evidence holds.

## Solution

Each contract the nine rows touch ends with exactly one test that can fail for it. The three weak tests are strengthened in place. The two consolidations move their one unique assertion into the keeper the ledger names and delete the rest. The four deletions remove tests whose contract a named keeper already pins. The one mention-rule case core's own table lacks (a sensitive column `caf` is not mentioned by "Open the café.") moves into core's `findMentionedNames` table, where the rule lives. The rag package's tests stay green with one test-file diff per touched file, and no production code moves.

## User Stories

1. As a maintainer changing the chunker's long-body splitter, I want the splitting test to fail if a chunk splits a paragraph, so that a character-slicing rewrite can't pass review.
2. As a maintainer changing the splitter, I want the test to pin the `#bc:1..#bc:N` ids in order, so that a numbering change (0-based, gaps, reordering) breaks the test.
3. As a maintainer changing the pgvector store, I want a unit test showing that a store built without `dimensions` can still upsert, so that adding an unconditional width check is caught without a database.
4. As a maintainer, I want the pgvector integration test that promises "a committed lock into a fresh table" to set up a lock that matches, so that the real-database run proves the store, not the lock, decides what to re-embed.
5. As a maintainer reading the integration test, I want it to assert its own premise (the lock exists after step 1), so that the premise can't silently disappear again the way it did with `7a0f777d`.
6. As a maintainer, I want the only non-zero `stats.byType["tenant-policy"]` check kept, in the test that already pins the tenant-policy section ids, so that the tally stays covered after its old test is removed.
7. As a maintainer, I want the mention rule's cases to live in core's table only, so that the rule has one owner and the chunker's tests prove only that the chunker uses it.
8. As a maintainer, I want the "Open the café." / `caf` case kept in core's table, so that the non-ASCII trailing-word-character case isn't lost when the chunker's copy is deleted.
9. As a maintainer, I want tests that can't fail on their own contract deleted (lock-key ordering in the indexer, in-process determinism, "not sensitive by default", the restart re-embed), so that the suite has fewer tests that only look like proof.
10. As a maintainer, I want each deleted test's keeper still present and passing, so that no contract loses its proof.
11. As the release process, I want an empty changeset, so that the Changesets workflow sees the `packages/*/src` change without releasing any package.
12. As a reviewer, I want the PR body to say how each repaired test was shown to fail under its regression, so that I can trust the repair without re-running the mutation.

## Implementation Decisions

Row by row, in the ledger's order. Line numbers are as of `2ff9332c` and only help find the test; the test names are what count.

- **F, chunker "splits long bodies on paragraph boundaries with `#bc:N` suffixes".** Replace the `length > 1` and `/#bc:\d+$/` checks with two assertions: the chunk ids for the orders table's business-context section are exactly the base id with `#bc:1`, `#bc:2`, … `#bc:N` in that order (with this test's six ~250-character paragraphs and `chunkSizeMaxChars: 600`, the splitter packs two paragraphs per chunk, so N is 3; build confirms it from a run rather than trusting this count); and each chunk's body is a run of whole `Paragraph i: x…` paragraphs joined by blank lines, every paragraph appearing whole in exactly one chunk, in order. How the body is pulled out of the chunk text (which carries a heading) is the builder's call; the assertion must fail if a paragraph is split across chunks.
- **C, chunker "emits tenant-policy chunks for the multi-tenant fixture".** Move `expect(stats.byType["tenant-policy"]).toBe(tpChunks.length)` into "emits one chunk per H2 section" (destructure `stats` there), then delete the old test. The keeper runs with `includeSensitiveDescribable: true`; the tally must equal the tenant-policy chunk count in that run.
- **D, chunker "tenant-policy chunks are not sensitive by default".** Delete. Keeper: "excludes a section that names a sensitive column unless opted in".
- **D, chunker "tenant-policy chunks are deterministic across runs".** Delete. Keepers: the golden snapshot test and "emits one chunk per H2 section".
- **C, chunker `it.each` "uses core's mention rule for a sensitive column named %j".** Delete the four-row `it.each`. Add one row to the `findMentionedNames` `it.each` table in core's `mentions.test.ts`, in that table's `[text, name, expected]` order: `["open the café", "caf", false]`, next to the existing `café` rows. If the enrich campaign (#519) has already merged that row when build runs, add nothing to core. The chunker's ADR 0017 block (the quoted and qualified mention tests) stays as the proof that the chunker uses core's matcher.
- **D, index "writes deterministic lock-file hash ordering".** Delete. Keeper: `lock-file.test.ts`'s test that writes unsorted hashes and asserts sorted output.
- **D, index "re-embeds everything into a fresh memory store even with an up-to-date lock (process restart)".** Delete. Keepers: "re-embeds everything when the lock matches but the store is empty (memory → file switch)" and "re-embeds only chunks the store is missing".
- **F, pgvector integration "indexes from a committed lock into a fresh table, then reuses from the store" (D1, option A).** Step 1 builds the index into a non-ephemeral store so `buildSchemaIndex` writes the lock: a memory store whose `describe()` reports `ephemeral: false`, the same wrapper `index.test.ts`'s `lockedMemoryStore` uses, or a file store in the test's temp directory; either meets D1. Add an assertion right after step 1 that the lock file exists. Keep the name, the rest of the test, and its cleanup; update the step 1 comment to say why the store must be non-ephemeral.
- **F, pgvector unit "reads and writes without a width, but needs one to create the table".** Keep its three assertions and add an `upsert` of one record with a 2-wide vector that resolves, and assert the client received exactly one `INSERT` query. The test's `clientWithTable` helper records every query but exposes only the DDL ones; widen what it returns as needed, inside the test file.
- **Changeset.** Add an empty changeset (frontmatter with no packages) with one line saying it is a test-only change from the rag test audit and needs no release, as `.changeset/test-audit-core.md` does.
- **No production code changes, no test-only seams.** The layer plan unlocks none; `MemoryStore.setHash` (dead public API) stays.

## Testing Decisions

- A good test here fails for the regression its name promises and for nothing else; it checks what the public functions return (`chunkSchema`, `buildSchemaIndex`, the store methods), not how they compute it.
- Each F repair is shown to fail before it is kept: build introduces the named regression in production code locally, sees the repaired test fail, and reverts. For the splitter, a splitter that slices the body every `maxChars` characters; for the pgvector upsert, a width check that throws when `dimensions` is unknown; for the integration test, step 1 back on an ephemeral `createMemoryStore()` (the new lock assertion fails). The PR body records each, one line each. The integration test runs only with `ASKDB_PGVECTOR_URL` set; with no local database, build shows it type-checks (`pnpm lint`) and leaves the run to CI's `test` job, which sets `ASKDB_REQUIRE_INTEGRATION=1`.
- Each C and D row is checked by naming its keeper in the PR body and showing it still passes.
- Prior art: `index.test.ts`'s `lockedMemoryStore` for a non-ephemeral memory store; core's `findMentionedNames` `it.each` table for the moved row; the earlier test-audit changesets (`test-audit-core.md`, `test-audit-ai.md`, `test-audit-db.md`) for the empty changeset.
- Every new or changed test passes the `factory-test-audit` gate.

## Ticket coverage

| Ticket item (issue body) | Met by |
| --- | --- |
| Each `F` row repaired; its assertion can now fail for the regression it names | Implementation Decisions: the three F bullets; Testing Decisions: the mutation check |
| Each `C` row consolidated into its keeper with the carried assertions | Implementation Decisions: the two C bullets |
| Each `D` row deleted, its named proof still present and passing | Implementation Decisions: the four D bullets; Testing Decisions: keepers named in the PR body |
| Each test-only production seam the plan unlocks is removed (none) | Implementation Decisions: "No production code changes, no test-only seams" |
| `pnpm test` green and `pnpm lint` passes | Testing Decisions; Done when |
| Row: chunker "splits long bodies…" (F) | F, chunker bullet |
| Row: chunker "emits tenant-policy chunks…" (C) | C, chunker tenant-policy bullet |
| Row: chunker "not sensitive by default" (D) | D bullet |
| Row: chunker "deterministic across runs" (D) | D bullet |
| Row: chunker "uses core's mention rule…" (C) | C, mention-rule bullet |
| Row: index "deterministic lock-file hash ordering" (D) | D, index bullet |
| Row: index "(process restart)" (D) | D, index bullet |
| Row: pgvector integration "indexes from a committed lock…" (F) | F, pgvector integration bullet; D1 |
| Row: pgvector "reads and writes without a width…" (F) | F, pgvector unit bullet |
| Triage brief: an empty changeset is present | Implementation Decisions: Changeset |

## Out of Scope

- The three possible product bugs the campaign noted (a memory or file store keeping a stale hash on a re-upsert without one; pgvector `close()` not resetting its client; the dead `MemoryStore.setHash`). Each needs its own reproduction and issue; removing `setHash` is a public-API change with a minor changeset.
- The coverage gaps the campaign noted: `createFileStore({ autoFlush: false })`, `chunkSchemaBundle` and `loadChunkerSourcesFromBundleJson` (including the `bundled` guard), and the tenant-policy no-H2 `#body` fallback.
- Option B of D1 (drop step 1 and rename): not taken; the owner can choose it at approval.
- Any production code change.

## Further Notes

- The enrich campaign (#519) proposes the same core row, and its own chunk of that table may move; build checks `main` and #519's state before adding it, so the row lands once.
- Expected size from triage: about 85 changed lines across six files (five test files and the changeset).
