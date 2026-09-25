# Plan 064: Lift foreign keys declared only on Postgres partitions up to the partitioned parent, deterministically and never across conflicting targets

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
> 1. `gh pr view 189 --repo Ygilany/AskDB --json state -q .state` → `MERGED`.
> 2. #189's leaf-FK filter is present: `git grep -n "inh.inhrelid IN (con.conrelid, con.confrelid)" packages/postgres/src/connector/templates.ts` → one match.
> 3. The problem still exists: `git grep -n "partition_foreign_keys\|partition_fk_" packages/` → no matches; `git grep -n "rental#customer_id->table:public.customer#customer_id" packages/postgres/src/connector/pagila.integration.test.ts` → one match (the test #201 switched away from `payment`, because `payment` renders no relationships).
> 4. The Pagila pin is unchanged: `git grep -n "ARG PAGILA_GIT_REF=23f7fe7a1e9f5772f85fc14f530583ffa258c6d2" fixtures/pagila/Dockerfile` → one match. If the pin moved, re-check the Pagila facts below before continuing.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED — adds a catalog template (bundle format version) and makes relationships appear that were not declared on the parent.
- **Depends on**: PR #189 (merged). Conflicts: plans 061 and 062 also edit `packages/postgres/src/connector/describe.ts` — sequential, not parallel. Independent of 062's format work: lifted FKs are ordinary `SqlForeignKey`s.
- **Category**: bug (lost relationships) / direction
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No for live mode. For `--from-export`: `POSTGRES_TEMPLATE_VERSION` goes 1 → 2, and the reader keeps accepting version-1 bundles (with no lifting), so existing exports keep working.

## Premise correction — read before starting

The ticket that led to this plan said to lift FKs "that appear identically on **every** partition", so that Pagila's `payment → customer` renders. **At the pinned Pagila ref these two goals conflict.** `pagila-schema.sql` at `23f7fe7…` attaches **55** monthly partitions (`payment_p2022_01` … `payment_p2026_07`) to `payment`, but declares `customer_id`, `rental_id` and `staff_id` FKs on only the **first six** (`payment_p2022_01` … `payment_p2022_06`: 18 `ADD CONSTRAINT … FOREIGN KEY` lines). The `payment` parent declares only `PRIMARY KEY (payment_date, payment_id)`. Verify with:

```bash
curl -fsSL https://raw.githubusercontent.com/devrimgunduz/pagila/23f7fe7a1e9f5772f85fc14f530583ffa258c6d2/pagila-schema.sql -o /tmp/pagila.sql
grep -c "ATTACH PARTITION public.payment_p" /tmp/pagila.sql          # → 55
grep -oE "payment_p[0-9_]+_(customer|rental|staff)_id_fkey" /tmp/pagila.sql | sort -u | wc -l   # → 18
```

A strict "every partition" rule therefore lifts **nothing** on Pagila. This plan implements the **consistent-subset rule** below. It lifts Pagila's three FKs, never lifts when partitions disagree, and reports partial coverage as a warning so nothing happens silently. The strict rule is a one-line change (`declaredOn === partitions`). If the maintainer prefers it, see STOP conditions.

**The rule** (per partitioned root table `T`, per ordered local column list `L`):
1. Collect the FK *targets* (referenced `schema.table` plus ordered referenced columns) declared on `L` by `T`'s leaf partitions (relkind `'r'`, at any depth).
2. If `T` itself already has an FK on exactly `L` → do nothing (the parent's own FK already renders).
3. If more than one distinct target appears → **do not lift**. Emit `{ code: "partition_fk_conflict", table, columns }`.
4. Otherwise lift one FK onto `T`: name `${T.name}_${L.join("_")}_fkey` (Postgres' default naming), same columns and target, and `onDelete`/`onUpdate` only when every declaring leaf agrees (otherwise `undefined`).
5. If the number of declaring leaves `k` is less than the leaf count `n`, also emit `{ code: "partition_fk_partial", table, columns, references, declaredOn: k, partitions: n }`.
6. Skip any leaf FK whose *referenced* relation is itself a partition leaf (never invent an edge to a relation the `tables` template drops).

## Why this matters

After #189, FKs attached to partition leaves are correctly kept away from leaves (ADR 0003). But schemas that declare FKs only on partitions — common with `pg_partman`, `pg_dump` output from older versions, and Pagila — now show the partitioned table with no relationships at all, so the model loses join paths such as `payment → customer`. Lifting consistent leaf FKs restores them. It never merges conflicting targets, and the warning makes partial coverage visible.

## Current state (verified on c7404d4)

- `packages/postgres/src/connector/templates.ts`:
  - `TABLES_TEMPLATE` drops any relation with a `pg_inherits` parent of `relkind = 'p'` (leaves at any depth, including intermediate sub-partitioned tables).
  - `FOREIGN_KEYS_TEMPLATE` drops constraints where either side is such a leaf: `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inh JOIN pg_catalog.pg_class p ON p.oid = inh.inhparent WHERE inh.inhrelid IN (con.conrelid, con.confrelid) AND p.relkind = 'p')`. It deliberately avoids `conparentid` so the suite still runs on PG10.
  - `POSTGRES_TEMPLATE_VERSION = 1`; `POSTGRES_TEMPLATES` holds 12 templates; `SYSTEM_SCHEMA_PREDICATE` and `FILTER_PREDICATE` expect the namespace alias `n`.
- `packages/postgres/src/connector/describe.ts`: `describePostgres` runs each template through `run<T>(name)`; `foldIntrospectionResult(input: FoldInput)` builds tables, with `buildForeignKeys(rows)` grouping by constraint and sorting by name. `mapFkAction(code)` maps `PG_FK_ACTION_BY_CODE`.
- `packages/postgres/src/connector/bundle.ts`: `readManifest` rejects `parsed.version !== POSTGRES_TEMPLATE_VERSION`; `readBundleRows` requires a file for **every** template in `POSTGRES_TEMPLATES`; `validateFilesMap` rejects unknown template names; `filterBundleRows` filters every row type by `schema_name`.
- `packages/postgres/src/connector/row-types.ts`: one row type per template.
- `packages/introspect/src/types.ts` `IntrospectionWarning`: union including `cross_database_fk` (added by #189). No consumer switches exhaustively on `code` (`git grep -n "\.code ===" packages apps` shows none for warnings).
- Tests: `partition-fk.integration.test.ts` (live, `DATABASE_URL`; random schema; `events` partitioned by list with a parent-declared FK). `pagila.integration.test.ts` asserts `expect(result.warnings).toEqual([])` and a `rental → customer` relationship. `describe.test.ts` "templates() returns the canonical bundle with all 12 templates". `bundle.test.ts` "rejects unknown engines and version mismatches" (uses version `999`).
- Docs: `docs/adrs/0003-postgres-partition-handling.md` (no FK section), `docs/integration/postgres-partitioned-tables.md`, `docs/specs/introspection.md` (lists warning codes). The docs site has no partition content (`grep -rni partition apps/docs-site/src/content/docs` → nothing).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build / typecheck | `pnpm build && pnpm lint` | exit 0 |
| Postgres unit tests | `pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/connector` | all pass |
| Live | `DATABASE_URL=… PAGILA_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/pagila ASKDB_REQUIRE_INTEGRATION=1 pnpm --filter @askdb/postgres test` (`pnpm pagila:up` first) | all pass, 0 skipped |
| Template print | `pnpm --filter askdb build && node apps/cli/dist/cli.js introspect templates --engine postgres \| grep -c "^-- "` | `13` |
| All / release | `pnpm test && pnpm docs:build && pnpm smoke:install && pnpm preflight` | exit 0 |

## Scope

**In scope**: `packages/postgres/src/connector/{templates,row-types,describe,bundle}.ts`; `packages/introspect/src/types.ts` (two warning variants); tests `describe.test.ts`, `bundle.test.ts`, `partition-fk.integration.test.ts`, `pagila.integration.test.ts`; fixture `fixtures/introspect/partition-fk-lift.catalog.json` (create) and `fixtures/introspect/README.md`; docs `docs/adrs/0003-postgres-partition-handling.md` (append an amendment), `docs/integration/postgres-partitioned-tables.md`, `docs/specs/introspection.md`, `docs/integration/connectors.md` (only if it lists warning codes); `.changeset/postgres-lift-partition-fks.md`.

**Out of scope**: the `FOREIGN_KEYS_TEMPLATE` SQL (keep #189's filter byte-identical); the `TABLES_TEMPLATE`; plain inheritance (`INHERITS`) children, which are real tables; FKs that *reference* partition leaves (skipped, rule 6); the renderer and core; other engines.

## Git workflow

- Branch `plan/064-lift-partition-leaf-fks`; one PR; do not merge. E.g. `feat(postgres): lift partition-leaf foreign keys onto the partitioned parent`.

## Steps

### Step 1: `partition_foreign_keys` template

Add `PostgresSqlTemplateName` `"partition_foreign_keys"`, a row type `PartitionForeignKeysRow` in `row-types.ts`, and a template whose columns are `schema_name, table_name, leaf_count, leaf_schema_name, leaf_table_name, constraint_name, key_position, column_name, referenced_schema_name, referenced_table_name, referenced_column_name, on_delete_code, on_update_code`. Where `schema_name`/`table_name` name the **root** (a `relkind = 'p'` table with no partitioned parent):
- `WITH RECURSIVE` over `pg_inherits` from each root to all descendants (no `pg_partition_tree`, which is PG12+). Keep leaves with `relkind = 'r'`; `leaf_count` is the per-root count of those leaves.
- Join each leaf's `pg_constraint` rows with `contype = 'f'`, unnesting `conkey`/`confkey` `WITH ORDINALITY` exactly as `FOREIGN_KEYS_TEMPLATE` does.
- Exclude constraints whose `confrelid` is a partition leaf (same `NOT EXISTS` predicate on `con.confrelid`).
- Apply `SYSTEM_SCHEMA_PREDICATE` and `FILTER_PREDICATE` to the **root's** namespace, aliased `n`.
- `ORDER BY schema_name, table_name, leaf_schema_name, leaf_table_name, constraint_name, key_position`.
- A doc comment citing this plan's rule and ADR 0003's amendment.

Append it to `POSTGRES_TEMPLATES` (last) and set `POSTGRES_TEMPLATE_VERSION = 2`.

**Verify**: `pnpm --filter @askdb/postgres build` → exit 0. The "all 12 templates" test now fails; update it to 13 and assert that the last template's name is `partition_foreign_keys` → passes.

### Step 2: Fold — implement the rule

In `describe.ts`, run the new template last in `describePostgres` and add `partitionFkRows` to `FoldInput`. Add a pure `liftPartitionForeignKeys(rows, existingFksByTable)` returning lifted `SqlForeignKey`s per `schema.table`, plus warnings. Implement rules 1–6 exactly as written above, iterating in sorted order so output is deterministic. Merge the lifted FKs into each root table's `foreignKeys` (only for tables that survive `tableFilter`) and re-sort by name. Add the two warning variants to `IntrospectionWarning` in `packages/introspect/src/types.ts`, with doc comments:

```ts
| { code: "partition_fk_partial"; table: string; columns: string[]; references: string; declaredOn: number; partitions: number }
| { code: "partition_fk_conflict"; table: string; columns: string[] }
```

`table` is the root's `table:<schema>.<name>`; `references` is the target's `table:<schema>.<name>`.

**Verify**: `pnpm --filter @askdb/introspect --filter @askdb/postgres build && pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/connector/describe.test.ts` → existing tests pass (their snapshots have no `partition_foreign_keys` rows, so the snapshot runner returns none).

### Step 3: Bundles stay backward compatible

In `bundle.ts`: accept manifest `version` 1 **or** 2 (reject anything else, with the existing message). For a version-1 bundle, do not require or read `partition_foreign_keys` (treat it as empty, so nothing is lifted); for version 2, require it like every other template. Filter its rows by `schema_name` in `filterBundleRows`, and pass them to the fold.

**Verify**: `pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/connector/bundle.test.ts` → existing tests pass after updating any fixture manifests that now need the new file. The `999` case still rejects.

### Step 4: Tests (apply the test-audit authoring gate)

See Test plan. **Verify**: unit tests pass locally; the live suites pass with `ASKDB_REQUIRE_INTEGRATION=1` (locally, or in the PR's CI `test` job).

### Step 5: Docs and changeset

- Append `## Amendment (2026-09): foreign keys declared on partitions` to ADR 0003: the rule, why "consistent subset" rather than "every partition" (the Pagila facts), the two warnings, bundle version 2.
- `docs/integration/postgres-partitioned-tables.md`: a "Foreign keys declared only on partitions" section with a short example.
- `docs/specs/introspection.md`: add both warning codes to the `IntrospectionWarning` list and one line to the test bar.
- `.changeset/postgres-lift-partition-fks.md`: `@askdb/postgres` minor, `@askdb/introspect` minor (warning union). Mention bundle version 2 with version 1 still accepted.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm changeset status` → exit 0, no unexpected major; then `pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan

1. **Unit, owner = the fold** (`describe.test.ts` + a hand-written `fixtures/introspect/partition-fk-lift.catalog.json`; write the expected FKs and warnings by hand, not from output). One root `readings` with 3 leaves, containing:
   - an FK on all 3 → lifted, no warning;
   - an FK on 2 of 3 → lifted, one `partition_fk_partial` with `declaredOn: 2, partitions: 3`;
   - two leaves pointing the same column at different tables → not lifted, one `partition_fk_conflict`;
   - a column list the parent already covers → the parent FK is kept once, nothing lifted;
   - leaves whose `ON DELETE` actions differ → lifted with `onDelete` undefined;
   - running the fold twice gives deep-equal output.

   Catches: invented edges, lost edges, nondeterminism.
2. **Unit, owner = the bundle reader** (`bundle.test.ts`): a version-1 bundle without the new file loads and lifts nothing; a version-2 bundle missing the file is rejected with the existing "missing … for template 'partition_foreign_keys'" message.
3. **Live, owner = catalog SQL + fold** (`partition-fk.integration.test.ts`, extend the existing random-schema setup): a two-level sub-partitioned root whose FKs are declared only on the leaves (exercises the recursive CTE); a list-partitioned root with an FK on one of two leaves (partial warning); a root whose leaves reference different tables (conflict). The existing `events`/`event_notes` assertions must still pass unchanged (parent-declared FKs are not duplicated).
4. **Live, Pagila** (`pagila.integration.test.ts`): replace `expect(result.warnings).toEqual([])` with an assertion that the warnings are exactly three `partition_fk_partial` entries for `table:public.payment`, on `["customer_id"]`, `["rental_id"]`, `["staff_id"]`, each with `declaredOn: 6, partitions: 55` (comment: "pinned Pagila ref 23f7fe7; see plan 064"). Assert the rendered relationships include `table:public.payment#customer_id->table:public.customer#customer_id`. Keep the `rental → customer` assertion.

## Done criteria

- [ ] Readiness check passed and quoted in the PR description.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight` exit 0; CI integration job green with 0 skipped.
- [ ] `git diff origin/main...HEAD -- packages/postgres/src/connector/templates.ts` shows no change inside `FOREIGN_KEYS_TEMPLATE` or `TABLES_TEMPLATE`.
- [ ] `node apps/cli/dist/cli.js introspect templates --engine postgres | grep -c "^-- "` → `13`.
- [ ] Pagila: `payment → customer` renders and exactly three `partition_fk_partial` warnings are reported.
- [ ] ADR 0003 amendment, docs and changeset present.

## STOP conditions

- Readiness check fails, or the Pagila pin moved and the 6/55 facts no longer hold.
- The maintainer (or PR review) rejects partial-coverage lifting. Switch to the strict rule (lift only when `declaredOn === partitions`; drop `partition_fk_partial`), and change the Pagila assertion to "`payment` has no relationships". Report that the Pagila goal is then unreachable at this pin. Do not invent a middle rule such as a percentage threshold.
- The recursive CTE fails on PG10/11 syntax, or a live run shows the template is materially slower than `foreign_keys` on Pagila (> 2× wall time). Report numbers.
- Implementing the rule seems to require changing `FOREIGN_KEYS_TEMPLATE` or the renderer.

## Maintenance notes

- Lifted FKs describe joins the database does not enforce on every partition. They are join hints for the model. That trade-off is recorded in the ADR 0003 amendment; revisit it if lifted edges ever feed enforcement (they do not today).
- If plan 062 lands, lifted composite FKs get `constraint` grouping automatically; the synthesized name is the group key.
- When `pg_partman` users add partitions monthly, `declaredOn`/`partitions` counts change, and `--diff` sees changed warnings but the same `schema.json`. Warnings are not part of the artifact, so this is expected.
- Reviewer focus: rule 3 (never merge conflicting targets), rule 6 (never point at leaves), determinism, and version-1 bundle compatibility.
