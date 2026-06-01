# ADR 0003 — Postgres partitioned-table handling in introspection and RAG

## Status

Accepted (2026-05-12).

## Context

PostgreSQL's declarative partitioning expresses one logical table as a parent
relation plus one row in `pg_class` per child partition (and, for hash- or
range-partitioned hierarchies, per sub-partition). Catalog `relkind` values:

| `relkind` | Meaning                              |
| --------- | ------------------------------------ |
| `r`       | Ordinary table **or partition leaf** |
| `p`       | Partitioned (parent) table           |
| `v`       | View                                 |
| `m`       | Materialized view                    |

The trap: a leaf partition has `relkind = 'r'` — exactly the same value as a
plain table. There is no way to distinguish them on `relkind` alone. The
authoritative signal is `pg_inherits`: any partition leaf has a row there with
`inhparent` pointing to the partitioned parent (whose `relkind` is `'p'`).

`packages/postgres/src/connector/templates.ts` selects
`relkind IN ('r', 'p', 'v', 'm')` and returns every match. Downstream:

- `describePostgres` (`describe.ts:254`) keeps everything with
  `relkind IN ('r', 'p')`, treating partition leaves as first-class tables.
- The schema renderer writes one entry per leaf into the v2 schema directory.
- The RAG chunker (`packages/rag/src/chunker/chunker.ts`) emits one table chunk,
  N column chunks, etc., per leaf.
- pgvector retrieval surfaces the leaves at query time, so user questions about
  the logical table return many near-duplicate hits drowning the parent.

Symptom in production: a single partitioned `events` table with 64 monthly
partitions appears 65 times in the index; NL→SQL prompts and retrieval
quality both degrade because the parent — the only relation a user should
ever query — competes with 64 lookalikes.

## Decision

**Filter partition leaves out at the SQL boundary.** Modify `TABLES_TEMPLATE`
to `LEFT JOIN pg_inherits` against partitioned parents and exclude any
relation that is a leaf of such a parent. The partitioned parent (`relkind =
'p'`) is retained and surfaced as the canonical table. Plain inheritance
(non-declarative `INHERITS (...)`) is **not** filtered — those children are
genuinely independent tables in PG semantics.

The change is contained to `packages/postgres/src/connector/templates.ts` and a
new fixture for partitioned snapshots. No type changes, no schema-v2 changes,
no chunker changes.

## Alternatives considered

### Option A — Filter at the SQL boundary (chosen)

Modify `TABLES_TEMPLATE` so partition leaves never enter the pipeline.

**Pros**

- Smallest blast radius: one SQL template, one new fixture.
- Every downstream consumer benefits transparently — `describe`, schema
  renderer, exports, schema lock hash, RAG chunker, pgvector store, NL→SQL
  context selection.
- The filter happens where the catalog truth lives (Postgres). No risk of a
  consumer "forgetting" to filter.
- Schema-v2 output stays clean — diffs no longer churn whenever DBAs add a
  monthly partition.

**Cons**

- Loses partition-level metadata entirely. If we later want partition counts,
  per-partition row counts, or partition-key suggestions, we have to add it
  back as a separate template.
- Slightly more complex SQL (one extra `LEFT JOIN`). Negligible at this scale.
- Potentially surprising for a developer reading the templates file expecting
  `relkind = 'r'` to mean "all base tables." Mitigated by an inline comment
  pointing at this ADR.

### Option B — Surface partition metadata through the schema model

Add `is_partition` / `parent_table` columns to the tables row, propagate them
through `TablesRow` → `SqlTable`, then have the chunker (and any other
consumer) decide what to do with leaves.

**Pros**

- Preserves the information. UI / TUI / docs-site could render partition
  counts, sizes, or a "partitioned by" hint.
- Per-consumer policy: chunker can fold leaves into the parent's chunk;
  exports could keep them; the NL→SQL context could omit them.

**Cons**

- Touches every layer: SQL template, row types, `SqlTable`, schema-v2 JSON
  contract, schema-v2 loader, renderer, and at least the chunker. That is a
  schema-v2 contract change with a version bump.
- Every future consumer must remember the filter rule; the default is unsafe.
- We do not have a near-term product surface that consumes partition metadata.
  Building the contract speculatively violates the "no design for hypothetical
  futures" rule.
- ADR 0002's `dialect` adapter contract becomes leakier: a Postgres-specific
  concept (`is_partition`) starts living in the engine-agnostic schema model,
  forcing future MySQL / Prisma integrations to either ignore it or fake it.

### Option C — Filter at the chunker only

Leave introspection untouched; teach the RAG chunker to detect and skip
partition-shaped table names (e.g. by parent prefix or naming convention).

**Pros**

- One file changes (`chunker.ts`). Cheapest patch.

**Cons**

- Naming-convention heuristics (`events_2025_03`, `events_p0`, etc.) are not
  reliable across teams or codebases.
- Without a structured `is_partition` flag, the chunker has no signal — it has
  already lost the catalog truth by the time chunks are formed.
- Partition leaves still pollute every other surface: `describe` output, the
  schema-v2 directory, exports, NL→SQL prompt context. RAG is only one of the
  consumers; the others will keep seeing the leaves.
- Schema lock hash still churns on every partition add/drop.

## Rationale

- The ADR-0002 boundary makes `@askdb/postgres` the right home for
  Postgres-specific catalog quirks. Partitioning is exactly that.
- The dialect-agnostic schema model (`SqlSchema`, `SqlTable`, schema-v2 JSON)
  should not learn engine-specific concepts unless a product surface consumes
  them. We have none today.
- Partition leaves carry no information a user query can act on — the parent
  is the only relation the planner routes through. The `SELECT … FROM events`
  case works against the parent; querying a leaf directly is an operational
  / DBA concern, not an NL→SQL concern.
- The fix should land in the layer that owns the catalog read. Pushing the
  decision up to consumers spreads policy across packages and makes the
  default unsafe.

## Consequences

- Partition leaves disappear from `describePostgres` output, from
  schema-v2 directories, from RAG chunks, and from the NL→SQL context.
- `relkind = 'p'` parents are kept and chunked normally. RAG retrieval over
  the partitioned table now returns one canonical hit instead of N+1 hits.
- A new `partitioned-tables.catalog.json` fixture exercises the filter.
- If we ever add partition-aware product features (partition pruning hints,
  per-partition sizes), we revisit this ADR and likely move to Option B with
  a schema-v2 minor bump.
- The schema lock hash for any database with declarative partitioning will
  change once on first re-introspection. Documented in the changeset.

## Out of scope

- Plain table inheritance (`CREATE TABLE x INHERITS (y)`) — kept; these are
  semantically distinct relations with their own data, not partitions.
- Foreign tables (`relkind = 'f'`) — neither selected today nor in scope here.
- Materialized-view leaves of any kind — N/A; matviews are not partitioned.
- A `partitions` template exposing leaf metadata to the UI — deferred until a
  consumer needs it.

## Related

- ADR 0002 — Integration-package layout (`docs/adrs/0002-integration-package-layout.md`).
- Introspection spec (`docs/specs/introspection.md`).
- RAG spec (`docs/specs/rag.md`).
- Postgres docs: <https://www.postgresql.org/docs/current/ddl-partitioning.html>
