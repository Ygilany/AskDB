# Plan 062: Carry composite foreign keys, enum labels and database comments from introspection into `schema.json` and the model's prompt

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `plans/README.md` — unless a reviewer dispatched you and told you they maintain the index.
>
> **Readiness check (run first)** — all must hold, otherwise STOP:
> 1. `for n in 189 195; do gh pr view $n --repo Ygilany/AskDB --json state -q .state; done` → `MERGED` twice.
> 2. `git grep -n "export function renderSchemaV2Body" packages/introspect/src/render/render.ts` → one match (the shared `--out`/`--print`/`--diff` body from #189).
> 3. The gap still exists: `git grep -n "constraint\|comment\|enum" packages/core/src/schema/v2/physical.ts` → no matches; `git grep -n "relationships" packages/core/src/schema/v2/format.ts` → no matches; `git grep -n "emit one relationship per pair" packages/introspect/src/render/render.ts` → one match.

## Status

- **Priority**: P2
- **Effort**: L (three small features across five packages; commit them separately)
- **Risk**: MED — changes the artifact format and the full-schema prompt text.
- **Depends on**: PRs #189, #195 (merged). Conflicts: plans 061 and 064 edit `packages/postgres/src/connector/describe.ts` — sequential, not parallel.
- **Category**: direction / bug (lost fidelity)
- **Planned at**: `review/integration-check @ c7404d4, 2026-09-25`
- **Breaking**: No for readers — all new `schema.json` fields are optional, and older `@askdb/core` versions ignore them (the physical zod schema is a non-strict `z.object`, which strips unknown keys). The full-schema prompt text changes (new `FK` lines, comment-derived descriptions), and the first re-introspection after upgrading rewrites `schema.json` for databases that have comments, enums or composite FKs, so `--diff` reports `changed: true` once.

**Premise note**: "Schema v2 minor bump" does **not** mean changing the `version` literal. `docs/contracts/schema-v2.md` § Versioning says pre-1.0 additive fields land in place without a version bump. This plan is a contract-doc revision plus minor changesets. Keep `"version": 2`.

## Why this matters

Connectors already read table/column comments, enum labels, and composite FK column lists, but the renderer throws them away. A composite FK `(tenant_id, sku) → products(tenant_id, sku)` becomes two unrelated `{from, to}` pairs, so nothing downstream can tell that both columns must be joined together. **Also, the full-schema prompt (`formatSchemaV2ForNlToSql`) shows no relationships at all**: `NormalizedV2Table.relationships` is loaded but never printed, so without RAG the model has to guess joins from column names. Postgres enum labels (the `values:` hint the prompt already prints for front-matter `enum`) and DB comments never reach the model unless someone re-types them into Studio. This plan persists all three in the physical layer, falls back to them when the describable layer is silent, and prints FK lines in the prompt.

## Current state (verified on c7404d4)

- `packages/core/src/schema/v2/physical.ts` — `v2ColumnSchema` = `{ id, name, type, nullable, primaryKey?, sensitive? }`; `v2RelationshipSchema = z.object({ from, to })`; `v2TableSchema` = `{ id, name, schema, sensitive?, columns, relationships? }`. All `z.object` (non-strict).
- `packages/introspect/src/render/render.ts` — `toV2Column` emits `id, name, type, nullable, [primaryKey], sensitive` (comment: "Field order matches the Phase 5 hand-authored fixtures"). `appendFkRelationships`:
  ```ts
  // The connector guarantees both lists have equal length and the same
  // declared (conkey/confkey) order — emit one relationship per pair.
  for (let i = 0; i < len; i++) {
    acc.push({ from: `${table.id}#${local[i]}`, to: `table:${fk.references.schema}.${fk.references.table}#${referenced[i]}` });
  }
  ```
  `toV2Table` / `toV2View` never read `comment`, `SqlEnum`, uniques, indexes, checks or defaults.
- `packages/introspect/src/types.ts` — `SqlTable.comment?` ("surfaced as informational only"), `SqlColumn.comment?`, `SqlColumn.udtName`, `SqlNamespace.enums: SqlEnum[]` (`{ schema, name, values }`). `SqlView` has no `comment`.
- Who fills what: Postgres fills table/column comments and `SqlEnum`s (`describe.ts` `foldIntrospectionResult`; `ColumnsRow` has `udt_schema` + `udt_name`); Prisma fills comments from `documentation` and `SqlEnum`s from DMMF enums (`packages/prisma/src/prisma.ts`; enum columns have `field.kind === "enum"` and `udtName = field.type`); MySQL fills comments (`table_comment` may be `""`) and its enum labels already appear inside the `type` string (`column_type`, e.g. `enum('a','b')`); SQL Server and SQLite fill no comments.
- `packages/core/src/schema/v2/loader.ts` `buildNormalized` — column `description`/`aliases`/`enum` come only from front-matter and only when not sensitive; table `description` = first paragraph of the markdown body, only when a `tables/*.md` exists; `relationships: physTable.relationships` passed through.
- `packages/core/src/schema/v2/format.ts` `formatSchemaV2ForNlToSql` — prints `TABLE`, description, column lines (`-- aliases: …; values: a|b; description`), CQL. No relationships.
- `packages/rag/src/chunker/chunker.ts` — table chunk prints `Relationships:` then `- ${r.from} -> ${r.to}` per pair; `buildRelationshipChunk` emits one chunk per pair with id `chunkId(schemaId, `${rel.from}->${rel.to}`)` and text `Relationship: <from-table>.<col> references <to-table>.<col>`. Column chunks already print `col.description` and `Values: …` from the normalized schema.
- `packages/enrich/src/workspace.ts` `parsePhysical` re-parses `schema.json` with `v2SchemaJsonSchema` and `bundleSchemaDirectory` writes the parsed object into bundles — fields missing from the zod schema are silently dropped from bundles.
- Tests that pin today's behavior: `packages/postgres/src/connector/render-integration.test.ts` ("emits one relationship per FK column pair (multi-column FK)" over `fixtures/introspect/multi-column-fk.catalog.json`); the byte-for-byte golden `fixtures/introspect/orders-users.expected-schema.json` (no comments, enums or composite FKs — must stay byte-identical); `fixtures/schemas/orders-users.schema/.chunks.golden.json` (must stay identical).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build / typecheck | `pnpm build && pnpm lint` | exit 0 |
| Package tests | `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/schema/v2` (same for `@askdb/introspect`, `@askdb/postgres`, `@askdb/prisma`, `@askdb/rag`) | all pass |
| All tests | `pnpm test` | exit 0 |
| Docs | `pnpm docs:build` | exit 0 |
| Release checks | `pnpm smoke:install && pnpm preflight` | exit 0 |
| Pagila (optional locally) | `pnpm pagila:up`, `PAGILA_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/pagila pnpm --filter @askdb/postgres test` | all pass |

## Scope

**In scope**:
- `packages/core/src/schema/v2/{physical,normalized,loader,format}.ts`, a new `packages/core/src/schema/v2/relationships.ts` (grouping helper), `packages/core/src/schema/v2/index.ts` and `packages/core/src/index.ts` (export the helper), and their tests
- `packages/introspect/src/types.ts`, `packages/introspect/src/render/render.ts`
- `packages/postgres/src/connector/describe.ts` (populate `enumValues`, view comments), `packages/prisma/src/prisma.ts` (populate `enumValues`)
- `packages/rag/src/chunker/chunker.ts` (group composite relationships) and its tests
- Fixtures: `fixtures/introspect/fidelity.catalog.json` + `fixtures/introspect/fidelity.expected-schema.json` (create), `fixtures/introspect/README.md`
- Tests: `packages/postgres/src/connector/render-integration.test.ts`, `pagila.integration.test.ts`, `packages/prisma/src/prisma.test.ts` (+ its `__snapshots__` if they change)
- Docs: `docs/contracts/schema-v2.md`, `docs/specs/introspection.md`, `apps/docs-site/src/content/docs/concepts/the-schema-artifact.mdx`, `…/concepts/privacy-model.mdx`, `…/guides/author-your-schema.mdx`
- Changesets (see Step 7)

**Out of scope**:
- Rendering unique constraints, indexes, check constraints or defaults — each needs its own prompt-value argument; follow-up.
- SQL Server comments (`MS_Description` extended properties), MySQL enum parsing (labels are already in the `type` string), SQLite (no comments).
- Studio UI (showing DB comments as placeholder text, grouping composite relationships in `SchemaTab.tsx`/`EnrichmentTab.tsx`) and `@askdb/enrich` seeding front-matter from comments.
- Any change to the `version` literal, stable ID scheme, or `mergeWithExistingArtifact`.

## Git workflow

- Branch `plan/062-renderer-fidelity`; one PR; do not merge. One commit per step, e.g. `feat(core): optional comment/enum/constraint fields in Schema v2 physical layer`.

## Steps

### Step 1: Physical schema fields (core)

In `physical.ts` add, all optional: column `comment: z.string().min(1)` and `enum: z.array(z.string()).min(1)`; table `comment: z.string().min(1)`; relationship `constraint: z.string().min(1)` (doc comment: "Set on every pair of a multi-column foreign key; all pairs of one key share the value and appear consecutively in key order"). Mirror `constraint?: string` in `NormalizedV2Table["relationships"]` (`normalized.ts`).

Create `relationships.ts` exporting `groupRelationships(rels)` → `Array<{ constraint?: string; pairs: Array<{ from: string; to: string }> }>`: pairs without `constraint` are singleton groups; pairs with one are grouped by the key `constraint + "\0" + <target table id>` (the part of `to` before `#`), preserving first-seen order. The target is part of the key because Prisma and SQLite synthesize FK names from local columns only, so two different FKs on the same columns can share a name. Export it from `packages/core/src/schema/v2/index.ts` and `packages/core/src/index.ts`.

**Verify**: `pnpm --filter @askdb/core build && pnpm --filter @askdb/core lint` → exit 0.

### Step 2: Connector IR — enum labels

In `packages/introspect/src/types.ts` add `SqlColumn.enumValues?: string[]` ("labels of the column's enum type in declared order; set only when the connector can resolve the type") and `SqlView.comment?: string`.
- Postgres `describe.ts`: build `Map<"<schema>.<enum>", string[]>` from the already-sorted enum rows; in `buildColumn`, set `enumValues` from `${row.udt_schema}.${row.udt_name}` (exact match only — array types like `_mood` get nothing). Pass `tableCommentsByQualified.get(qualified)` into each `SqlView.comment`.
- Prisma `prisma.ts`: when `field.kind === "enum"`, set `enumValues` to the matching DMMF enum's `values.map((v) => v.dbName ?? v.name)` (match the enum by its Prisma `name`, which is what `field.type` holds).

**Verify**: `pnpm --filter @askdb/introspect --filter @askdb/postgres --filter @askdb/prisma build` → exit 0.

### Step 3: Renderer

In `render.ts`:
- `toV2Column`: key order `id, name, type, nullable, [primaryKey], [comment], [enum], sensitive`. Emit `comment` only when `column.comment?.trim()` is non-empty (store the text verbatim); emit `enum` only when `enumValues` is non-empty.
- `toV2Table`: key order `id, name, schema, [comment], sensitive, columns, [relationships]`, same empty rule. `toV2View`: same, from `view.comment`.
- `appendFkRelationships`: when `local.length > 1`, add `constraint: fk.name` to every pair. Single-column FKs stay exactly `{ from, to }` so existing artifacts do not churn. Replace the "emit one relationship per pair" comment with the new rule.

**Verify**: `pnpm --filter @askdb/postgres exec vitest run --config ../../vitest.config.ts src/connector/render-integration.test.ts` → only the multi-column FK case fails (it now sees `constraint`); "reproduces the orders-users golden byte-for-byte" still passes. Update that case's expectation to include `constraint: "store_inventory_product_fk"` / `"store_inventory_store_fk"` on the right pairs → all pass.

### Step 4: Loader fallbacks (core)

In `buildNormalized` (`loader.ts`):
- Column, only when not effectively sensitive: `description = mdCol?.description ?? cleanComment(physCol.comment)`; `enum = mdCol?.enum?.length ? mdCol.enum : physCol.enum`. Front-matter always wins.
- Table, only when not sensitive, **whether or not a `tables/*.md` exists**: `description = firstParagraph ?? cleanComment(physTable.comment)`.
- `cleanComment` collapses whitespace runs (including newlines) to single spaces and trims, so a multi-line DB comment cannot break the `-- ` comment lines in the prompt; returns `undefined` for empty results.
- `relationships` passes through unchanged, now including `constraint`.

**Verify**: `pnpm --filter @askdb/core exec vitest run --config ../../vitest.config.ts src/schema/v2` → existing tests pass.

### Step 5: Prompt — print foreign keys

In `formatSchemaV2ForNlToSql` (`format.ts`), after a table's column lines and before its CQL block, print one line per `groupRelationships(t.relationships)` group:

```
  FK (tenant_id, sku) -> public.products (tenant_id, sku)
  FK (user_id) -> public.users (id)
```

Column names are the id part after `#`; the target name is the target table's `schema.name` from `schema.tables`. Skip a group when the target table is missing or `tracked === false`. When `omitSensitiveIdentifiersFromPrompt` is on, skip a group if any column on either side is sensitive or either table is sensitive (sensitive tables are already stubbed before column lines). With the flag off, print the group (the identifiers are already listed and tagged). Do not change `stats`.

**Verify**: `pnpm --filter @askdb/core test` → any failure is only in tests that assert exact DDL for a fixture with relationships. Update those expectations to include the `FK` line, then re-run → all pass. If a failure is anything else, STOP.

### Step 6: RAG chunker — one chunk per composite key

In `chunker.ts`, iterate `groupRelationships(table.relationships)` in both places:
- Table chunk: single pairs keep `- ${from} -> ${to}`; a group prints `- (${froms.join(", ")}) -> (${tos.join(", ")})`. Apply the existing untracked/sensitive filters if **any** pair in the group matches.
- Relationship chunks: a single pair is unchanged (same id, same text). A group gets id `chunkId(schemaId, `${froms.join(",")}->${tos.join(",")}`)`, text `Relationship: <from-table> (<c1>, <c2>) references <to-table> (<c1>, <c2>)`, refs `[fromTableId, toTableId, ...froms, ...tos]`, sensitive if any side's table or column is sensitive.

**Verify**: `pnpm --filter @askdb/rag test` → all pass, and `git diff --exit-code fixtures/schemas/orders-users.schema/.chunks.golden.json` → no diff (do not set `UPDATE_RAG_GOLDEN`).

### Step 7: Docs, changesets, full gate

- `docs/contracts/schema-v2.md`: add the three fields to the physical example and the "Required … optional" paragraph; add "Precedence: front-matter `description`/`enum` and the markdown first paragraph override `schema.json` `comment`/`enum`; both are dropped for effectively sensitive tables/columns"; in the chunk table add the composite relationship chunk id/text; in Versioning add a dated line: "2026-09 additive revision: `comment`, `enum`, `relationships[].constraint`. Readers that predate it ignore them; `@askdb/enrich` bundles preserve them from this release on."
- `docs/specs/introspection.md`: one bullet saying comments, Postgres/Prisma enum labels and composite-FK grouping are rendered.
- Docs site: `concepts/the-schema-artifact.mdx` (the "structural facts" sentence gets DB comments, enum labels and FK grouping; the "model-facing text" paragraph mentions the `FK` lines), `concepts/privacy-model.mdx` ("What the model sees": DB comments and enum type labels are schema metadata that now reach the prompt unless the column/table is sensitive; FK lines are included), `guides/author-your-schema.mdx` (DB comments seed descriptions; front-matter overrides them). Verify each claim against your diff.
- Changesets: `@askdb/core` minor, `@askdb/introspect` minor, `@askdb/rag` minor (composite relationship chunk ids change → re-embed), `@askdb/postgres` minor, `@askdb/prisma` patch. Describe the one-time `--diff` churn and the new prompt `FK` lines.

**Verify**: `pnpm build && pnpm lint && pnpm test && pnpm docs:build && pnpm changeset status` → exit 0, no unexpected major; then `pnpm smoke:install && pnpm preflight` → exit 0.

## Test plan (apply the test-audit authoring gate)

1. **New golden, hand-written** — `fixtures/introspect/fidelity.catalog.json` (Postgres catalog rows: an enum `status` in two schemas with *different* labels, a table comment, a multi-line column comment, a composite FK, a view with a comment) and `fidelity.expected-schema.json`, **written by hand from the catalog rows, not generated by the renderer** (a generated golden is a test-audit junk pattern). Test in `render-integration.test.ts`: `renderToSchemaV2` output equals the golden byte-for-byte. Owner: renderer + Postgres fold. Catches: dropped fields, the wrong schema's enum labels, key-order churn.
2. The existing multi-column FK case (updated in Step 3) is the composite-FK regression guard; the unchanged orders-users golden guards "no churn for single-column FKs".
3. `packages/core/src/schema/v2/loader.test.ts`: physical comment/enum used when front-matter is silent; front-matter wins when present; table comment used when there is no `tables/*.md`; sensitive column/table drops both; multi-line comment collapsed. Owner: loader (the only place precedence and sensitivity are decided).
4. `format.test.ts`: composite key printed as **one** `FK (a, b) -> s.t (x, y)` line; omit mode drops a group touching a sensitive column; untracked target dropped.
5. `packages/rag/src/chunker/chunker.test.ts`: a composite key yields exactly one relationship chunk with the documented id; the single-pair chunk id is unchanged.
6. `packages/prisma/src/prisma.test.ts`: the `OrderStatus` enum column in `test-fixtures/simple/schema.prisma` gets `enumValues` in declaration order. If a stored snapshot changes, review the diff line by line and state in the PR that only `enumValues` changed.
7. Live Pagila (`pagila.integration.test.ts`): `film.rating` renders `"enum": ["G", "PG", "PG-13", "R", "NC-17"]` (Pagila's `mpaa_rating` type) and `loadSchema` returns it on the normalized column.
8. Physical zod: an artifact carrying all three fields loads, and an old artifact without them loads unchanged. Put these in the existing loader tests rather than a new file.

## Done criteria

- [ ] Readiness check passed and quoted in the PR description.
- [ ] `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm docs:build`, `pnpm smoke:install`, `pnpm preflight` exit 0.
- [ ] `git diff --exit-code fixtures/introspect/orders-users.expected-schema.json fixtures/schemas/orders-users.schema/.chunks.golden.json` → no diff.
- [ ] `git grep -n '"version": 3\|literal(3)' packages/core/src` → no matches.
- [ ] `git grep -n "groupRelationships" packages/core/src/schema/v2/format.ts packages/rag/src/chunker/chunker.ts` → matches in both.
- [ ] Every test in the Test plan exists and passes; CI integration job green.
- [ ] Changesets present; `pnpm changeset status` shows no unexpected major.

## STOP conditions

- Readiness check fails.
- A zod change makes an **existing** fixture or artifact fail to load — the fields must be optional and additive.
- `orders-users.expected-schema.json` or `.chunks.golden.json` would change — that means single-column output churned.
- Adding `FK` lines breaks a test outside `packages/core` that asserts exact prompt text (e.g. an eval harness) — report instead of rewriting expectations you don't own.
- The maintainer wants DB comments opt-in rather than on by default (privacy). Pause after Step 4 and ask; the switch would be a `formatSchemaV2ForNlToSql` option, not a loader change.

## Maintenance notes

- Renderer, loader, formatter and chunker must agree on grouping. Always use `groupRelationships`; never re-derive groups from adjacency.
- `comment` is stored verbatim; only the loader normalizes whitespace. Long comments go into prompts in full — watch prompt size on comment-heavy databases; truncation is a possible follow-up.
- Reviewer focus: precedence (front-matter over physical), sensitivity drops for the new fields, no churn for single-column FKs, the new `privacy-model.mdx` wording.
- Deferred: uniques/indexes/checks/defaults in the artifact; SQL Server `MS_Description`; Studio grouping display; seeding Studio drafts from comments.
