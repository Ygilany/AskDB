# Spec: apply the core-schema test-campaign plan (#509)

## For the owner

This spec applies the campaign's layer plan for `core-schema` tests in `@askdb/core` as one PR: 8 weak tests repaired, 4 folded into stronger keepers, 12 duplicates or placeholders deleted, two carry-over assertions added; test files only, no production change and no changeset.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. What changes | Exactly the issue body's rows and layer plan: each F repaired as its repair line says, each C removed with its carry-over added to the keeper, each D deleted with its named proof left in place | The ticket's plan, accepted as written at triage (Acceptance criteria) | Two-way: revert the PR |
| 2. What stays out | The three possible product bugs, the dead `isScopeThroughColumn` / `isScopeThroughJoin` helpers, the `caf`/`café` row move, and any core-guardrails (#508) file | Triage, Agent Brief "Out of scope" | Two-way |
| 3. Tenant scope accept rows | Delete the four `tenantScopeSchema` accept rows; their keepers are the four "passes with valid … scope" tests in the tenant-scope validator suite, which #508's plan keeps | Triage, "Cross-lane dependency resolved" | Two-way |
| D1. Ticket shape | One ticket in the standard lane, not the A/B split the issue suggests for the quick budget | default D1 | Two-way |

```text
schema tests (packages/core/src/schema)          keepers outside the plan's files
 normalize      ── :12, :27 (C) ─────────────────▶ prompt-boundary tests in sql/generate.test
                   :70 (F) repaired
 parse          ── :19, :29, :55 (F) repaired
 v2/format      ── :68 (C) ──▶ :59 (+ TABLE public.users); :25, :40 (F) repaired
 v2/loader      ── :83 (C) ──▶ v2/sensitivity-overrides :155 (+ email description)
                   :173, :179 (D)
 v2/parser      ── :30, :49 (F) repaired
 v2/tenant-policy ─ 10 rows (D) ─ 4 scope-shape rows ▶ sql/tenant-scope-validate.test :17-54
```

**Risks:** adding a `description` to the email entry of the sensitivity-overrides suite's inline `users.md` touches a fixture other tests in that file load; they must stay green. If #508 lands first and changes its plan for the validator tests, the scope-shape keepers could go missing.

**Done when:** every row in the issue's checklist is applied as listed, each repaired assertion fails when the regression it names is introduced, `pnpm test` and `pnpm lint` pass, and the diff touches only the seven test files.

**Needs you:** nothing.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The weekly test campaign audited the `core-schema` subsystem's tests (schema artifact parsing and loading, v1 and v2) at head `2ff9332c`. All 161 tests pass, but 8 of them pass for the wrong reason: their assertion cannot fail for the regression their name promises (for example, "rejects invalid JSON payload" passes valid JSON, "preserves body verbatim" only checks `toContain`). Four more repeat a stronger test elsewhere, and twelve are scaffold placeholders, fixture-inventory counts or duplicates. A maintainer reading or changing schema loading cannot trust these tests to catch a break, and the duplicates make the suite slower to read and change.

## Solution

One PR changes only test files under `packages/core/src/schema/` (and nothing in `sql/`). Each weak test keeps its name's contract and gains an assertion that fails when that contract breaks. Each consolidated test is removed and its one assertion worth keeping moves to the keeper. Each deleted test goes, and the test that already proves its contract stays. No test file is removed whole, no production file changes, and no package is published, so no changeset.

## User Stories

1. As a maintainer, I want the v1 normalize test for a sensitive table to fail when either column is missing from the prompt DDL, so that a dropped column can't hide behind a regex alternation.
2. As a maintainer, I want that test to assert the `(sensitive)` tag on each column line, so that a refactor that splits the tag from the count is caught.
3. As a maintainer, I want the v1 parse defaults (`nullable` true, `primaryKey` false) tested with a column that sets neither key, so that deleting a default fails a test.
4. As a maintainer, I want a non-JSON payload test that asserts `SchemaParseError` with "Failed to parse schema JSON", so that the JSON-parse wrapping branch is reached by a test.
5. As a maintainer, I want the test that passes `"{}"` renamed to say it rejects a schema-invalid payload, so that its name matches what it checks.
6. As a maintainer, I want the v1 sensitive-markers test to set and assert a column marker as well as the table one, so that its name's "tables and columns" holds.
7. As a maintainer, I want the v2 formatter test named for column aliases to assert `aliases: order_status`, so that alias rendering on column lines is checked somewhere.
8. As a maintainer, I want the v2 formatter's own sensitive-column exclusion tested with a column that carries a description and aliases, so that the test fails if the formatter starts printing them, not only if the loader stops stripping them.
9. As a maintainer, I want the bare-baseline formatter test to assert `TABLE public.users`, so that removing its near-twin loses nothing.
10. As a maintainer, I want the loader's stripping of describable fields from a schema.json-sensitive column tested with a real description present, so that the `toBeUndefined()` can fail.
11. As a maintainer, I want the v2 parser test named for aliases to assert `aliases`, so that the parser's alias extraction is checked directly.
12. As a maintainer, I want "preserves body verbatim" to compare the body with the source text after the front-matter, so that a trim or section drop fails it.
13. As a maintainer, I want the loader's placeholder tests that assert nothing their names promise removed, so that the suite doesn't claim coverage it lacks.
14. As a maintainer, I want tenant-policy tests that repeat the loader suite, the clean-fixture warnings test or the validator suite removed, so that each contract has one keeper.
15. As a maintainer, I want every deleted or consolidated test's keeper still present and passing, so that no contract loses its only proof.
16. As a reviewer, I want the PR to name each C row's keeper and each D row's remaining proof, so that I can check the plan row by row without re-running the audit.
17. As a host app developer, I want no production or published change in this PR, so that installing the next release behaves as before.

## Implementation Decisions

- **Scope (decision 1).** Build applies the issue body's rows, ledger evidence and layer plan as written; the issue is the source for each row's exact repair. Line numbers refer to `2ff9332c`; build locates rows by test name if lines have moved.
- **Repairs (F).**
  - v1 normalize, "lists sensitive-table columns with (sensitive) when not omitting": assert both `ssn_like_col` and `other_secret` and a `(sensitive)` tag on each column line (or the exact column lines); keep the stat assertion.
  - v1 parse, "normalizes nullable and primaryKey defaults": an inline schema with a column that sets neither key, asserting `{ nullable: true, primaryKey: false }` on the normalized column.
  - v1 parse, "rejects invalid JSON payload": rename to "rejects a schema-invalid payload" (still `"{}"`), and add a test with a non-JSON string asserting `SchemaParseError` and `/Failed to parse schema JSON/`.
  - v1 parse, "accepts optional sensitive markers on tables and columns": add `sensitive: true` on column `x` and assert it survives parsing.
  - v2 format, "includes column aliases and description on column lines": add an assertion that the DDL contains `aliases: order_status`.
  - v2 format, "excludes sensitive column describable fields from DDL": after loading, give the `email` column a description and aliases on the loaded schema (as the ignored-tables test mutates its schema), then assert the email line ends with `(sensitive)` and contains no `--`.
  - v2 parser, "extracts column front-matter with descriptions, aliases, and enum": assert the status column's `aliases` equal `["order_status"]`.
  - v2 parser, "preserves body verbatim": assert `parsed.body` equals the fixture text after the closing front-matter delimiter, computed from the raw file in the test, not from the parser.
- **Consolidations (C).**
  - Both v1 normalize tests for sensitive columns (default and omit) go; their keepers are the two prompt-boundary tests in the SQL generation suite ("lists sensitive column names in the model prompt by default", "omits sensitive identifiers from the prompt when deps omit flag is set"). Nothing to carry.
  - v2 format "still lists tables and columns with qualified names" goes; the bare-baseline test above it gains `expect(ddl).toContain("TABLE public.users")`.
  - v2 loader "excludes describable-layer fields for sensitive columns" goes; in the sensitivity-overrides suite, the inline `users.md` entry for `table:public.users#email` gains `description: Login address.`, and "front-matter `sensitive: false` cannot de-escalate a column or table, and warns" asserts the email column's `description` is undefined. Its warning assertions stay as they are.
- **Deletions (D).** v2 loader: the "loadSchema — validation errors" describe (both tests) goes whole. v2 tenant-policy: "loads the fixture with tenant policy", "includes all 9 tables from the physical layer", "does not load tenant policy for non-tenant schemas", "does not flag acyclic hierarchies", `tenantPolicyFrontmatterSchema` "accepts valid minimal policy" and "rejects invalid enforcement value", and the four `tenantScopeSchema` accept rows (ids, subtree, multi_root, global). Each row's remaining proof is the one its ledger row names.
- **Tenant scope keepers (decision 3).** The four accept rows rely on the tenant-scope validator suite's "passes with valid ids/subtree/multi_root/global scope" tests. Build confirms they exist on its checkout before deleting; if they are gone, it keeps the tenant-policy rows and says so in the PR, as the layer plan's coordination note says.
- **Imports.** Build removes imports a deletion leaves unused, so `pnpm lint` stays clean.
- **No seam removal.** The plan unlocks no test-only production seam; no production file changes.

## Testing Decisions

- A good test here asserts what the test's name promises through the public function it calls, and fails when that behavior breaks; it doesn't assert fixture inventory or repeat a keeper at a lower layer.
- **Mutation check for each F row.** Build temporarily breaks the production line each ledger row names (for example, drop `?? true` in v1 normalize, drop the aliases branch of the v2 column line, trim the parser body) and sees the repaired test fail, then restores it. The check is not committed; the PR body records it, one line per row.
- **Keeper check for each C and D row.** Build confirms each named keeper exists and passes before removing the row, and lists them in the PR body.
- **Gates.** `pnpm test` and `pnpm lint` pass. The sensitivity-overrides suite stays green after the fixture edit (every test in that file shares the inline `users.md`).
- **Prior art.** The v2 format ignored-tables test (mutating a loaded schema before formatting) and the sensitivity-overrides escalation tests (asserting stripped describable fields with real values present).
- Each new or changed test passes the `factory-test-audit` authoring gate.

## Ticket coverage

| Ticket item ("Acceptance criteria") | Met by |
| --- | --- |
| Each F row repaired, its assertion can fail for the regression it names | Implementation Decisions, Repairs; Testing Decisions, mutation check |
| Each C row consolidated into its keeper, with the carry-over assertions | Implementation Decisions, Consolidations |
| Each D row deleted, its remaining proof still exists and passes | Implementation Decisions, Deletions and Tenant scope keepers; Testing Decisions, keeper check |
| Each test-only production seam the plan unlocks is removed (none) | Implementation Decisions, No seam removal |
| `pnpm test` and `pnpm lint` pass | Testing Decisions, Gates |
| Triage: no production file changes, no changeset | Solution; decision 1 |
| Triage: one ticket, not split | D1 |

## Out of Scope

- The three possible product bugs the campaign noted (a bundle without `tables` throwing a raw `TypeError`, a missing path throwing raw ENOENT, `bundled: false` routing to the bundle loader). Bug 1 should be filed as its own issue.
- The dead `isScopeThroughColumn` / `isScopeThroughJoin` helpers in the tenant-policy loader.
- Moving the `caf`/`café` row into the mentions table test (the enrich and rag campaigns propose it; whichever lands first adds it).
- Any file in the core-guardrails lane (#508), including the tenant-scope validator suite.
- The "R 98" versus "R 99" mismatch in the issue header; it changes no row.

## Further Notes

- Triage sized 8 files counting a fixture; the email fixture is inline in the sensitivity-overrides test file, so the diff touches seven test files.
- The issue estimates about 185 changed lines.
