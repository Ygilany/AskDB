# Plan 053: Support self-referencing tenant hierarchies (an org tree in one table)

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat bdd7fe5..HEAD -- packages/core/src/schema/v2/tenant-policy.ts packages/core/src/schema/v2/tenant-policy-loader.ts packages/core/src/sql/tenant-placeholders.ts packages/core/src/sql/tenant-prompt.ts docs/contracts/tenant-policy.md` If plan 047 has landed, these files will have changed; re-read the "Current state" section against the live code before continuing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — like 047, this changes which rows a tenant-scoped query returns. Too few rows is an outage; too many is a cross-tenant leak.
- **Depends on**: plan 047 (**hard**). 047 makes `subtree` access expand descendants at all; this plan makes the hierarchy it expands expressible when parent and child are rows of the same table.
- **Category**: capability gap
- **Planned at**: commit `bdd7fe5`, 2026-09-26, from the consumer-lab design review ([`docs/specs/consumer-lab.md`](../docs/specs/consumer-lab.md))
- **Breaking**: No for existing policies; adds an optional policy field.

## Why this matters

The most common way to model tenant hierarchies is one organizations table with a `parent_id` pointing back at itself: an org can be parented by another org, to any depth. The maintainer's required semantics:

- a scope for org X sees X's rows **and every descendant's**;
- a child org **cannot** see its parent's (or any ancestor's) rows;
- nothing outside X's tree is ever visible.

AskDB's tenant policy cannot express this today.

- `roots[].parent` and `hierarchy[]` model parentage **between roots** — different tables (`agencies` → `sub_agencies` in `docs/contracts/tenant-policy.md`, pattern P4). A tree of unknown depth in one table would need one root per level, which is impossible when depth is data.
- Declaring the self-reference anyway (`hierarchy: [{ parent: table:org.agency, child: table:org.agency, foreignKey: …#parent_agency_id }]`) is reported by `detectHierarchyCycles` (`packages/core/src/schema/v2/tenant-policy-loader.ts`) as a `hierarchy_cycle`, because a self-edge is a cycle in the root graph.
- Even between roots, `subtree` access never expands descendants (plan 047).

## Evidence

The shared fixture `fixtures/multi-engine` carries exactly this shape in every engine:

- `org.agency(agency_id, parent_agency_id → org.agency)` has three roots (1 São Paulo, 2 Zürich, 3 Tokyo).
- São Paulo has children 4 Campinas and 5 Santos, and Santos has a child, 6 Santos Norte.
- Zürich has one child, 7 Winterthur.
- Every tenant-scoped table carries `agency_id`.

With these rows, the expected visible sets are:

| Scope | Visible agencies |
|---|---|
| 1 | 1, 4, 5, 6 |
| 5 | 5, 6 |
| 6 | 6 |
| 7 | 7 |
| 3 | 3 |

The consumer lab's tenant suite (phase 4) asserts these sets by executing generated SQL on every engine. Until this plan lands, those cases are expected to fail and are marked `it.fails` with a discrepancy id.

## Approach (to be confirmed by the maintainer before Step 2)

1. **Policy shape.** Add an optional `roots[].selfParentColumn` (a stable column id on the root table itself, e.g. `table:org.agency#parent_agency_id`). A root with this field is a tree. The loader validates that the column exists and references the root's own primary key, and it does **not** treat the self-reference as a hierarchy cycle. Actual data cycles, such as an org that is its own ancestor, are the host's problem and are guarded by expansion depth limits.
2. **Expansion reuses 047.** `subtree` access over a tree root expands `rootIds` to the root IDs plus all descendants.
   - With 047's host-supplied resolver (approach A), nothing new is needed beyond passing the root and column; the host knows its tree.
   - For 047's built-in approach B, emit a recursive CTE over `selfParentColumn`. The syntax differs by dialect: `WITH RECURSIVE` on Postgres, MySQL 8, MariaDB and SQLite; plain `WITH` (recursive by construction) on SQL Server.
3. **Ancestors are never included.** Expansion walks child ← parent edges downward only. There is no "include ancestors" option.
4. **Prompt.** `tenant-prompt.ts` states the tree semantics ("rows of this org and its descendants; never ancestors") and names the placeholder. The model must not be asked to write the recursion itself unless approach B is active.

## Steps (outline)

1. Schema and loader. Add `selfParentColumn`, and exempt a validated self-reference from `detectHierarchyCycles`. Test that the fixture's policy loads with zero warnings.
2. Expansion. With a resolver (047 A), prove that scope 1 yields `{1,4,5,6}`, scope 5 yields `{5,6}`, and scope 6 yields `{6}`. Without a resolver or approach B, **throw**; never under-scope silently (047's rule).
3. Built-in recursive CTE per dialect (optional, 047 B). Integration tests against `fixtures/multi-engine` on all five engines execute the SQL and compare the visible `agency_id` sets with the table above.
4. Docs: `docs/contracts/tenant-policy.md` (new field, pattern "P6: self-referencing tree"), `docs/specs/multi-tenancy.md`, `apps/docs-site/src/content/docs/guides/multi-tenancy.mdx`.
5. Changeset (`@askdb/core` minor).

## STOP conditions

- Plan 047 has not landed.
- The maintainer has not confirmed the policy field name and shape (Step 1). It is a public contract.
- Any engine's recursive CTE returns a different visible set from the table above.
