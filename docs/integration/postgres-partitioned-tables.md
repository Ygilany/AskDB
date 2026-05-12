# Postgres partitioned tables

> Status: as of 2026-05-12. Behavior decided in
> [ADR 0003 — Postgres partition handling](../adrs/0003-postgres-partition-handling.md).

PostgreSQL's declarative partitioning splits one logical table into a parent
relation plus one row in `pg_class` per partition leaf (and per sub-partition
in nested hierarchies). AskDB's Postgres connector treats the parent as the
canonical table and **filters partition leaves out of introspection**. This
page documents what that means in practice.

## What you see

Given a partitioned schema like:

```sql
CREATE TABLE events (
  id        bigserial,
  occurred  timestamptz NOT NULL,
  payload   jsonb
) PARTITION BY RANGE (occurred);

CREATE TABLE events_2025_03 PARTITION OF events
  FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE events_2025_04 PARTITION OF events
  FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
-- … one per month, indefinitely
```

`describePostgres` returns **one** entry — `public.events` — not 1+N. The
Schema v2 directory, the schema lock hash, the RAG chunks, and the NL→SQL
context all see only the parent.

## Why

- The parent is the only relation a user query should ever target. The
  planner routes inserts and selects through it, applying partition pruning
  automatically.
- Leaving leaves in the index meant N near-duplicate hits drowning the parent
  in RAG retrieval, and N redundant table chunks bloating the embeddings
  store.
- The schema lock hash used to churn whenever a DBA added a monthly
  partition, even though no user-visible schema had changed.

## How it's implemented

`packages/postgres/src/connector/templates.ts` — the `tables` template
`LEFT JOIN`s `pg_inherits` against partitioned parents (`relkind = 'p'`)
and excludes any relation that is a leaf:

```sql
LEFT JOIN pg_catalog.pg_inherits inh ON inh.inhrelid = c.oid
LEFT JOIN pg_catalog.pg_class    p   ON p.oid = inh.inhparent
                                    AND p.relkind = 'p'
WHERE p.oid IS NULL
```

Sub-partitions of sub-partitions are excluded by the same predicate at every
level (any leaf has a `pg_inherits` row whose `inhparent` is a partitioned
table; that match is enough to drop it).

## What is **not** filtered

- **The partitioned parent** (`relkind = 'p'`). Kept and surfaced as a normal
  `SqlTable`.
- **Plain inheritance** (`CREATE TABLE x INHERITS (y)` without
  `PARTITION OF`). The children are independent tables in PG's semantics,
  hold their own data, and are returned as-is. The filter checks
  `inhparent.relkind = 'p'`, so only declarative-partition leaves are
  dropped.
- **Foreign tables** (`relkind = 'f'`). Not selected today; out of scope.
- **Materialized views** (`relkind = 'm'`). Not partitionable; unaffected.

## What you lose

- Partition-leaf metadata (names, ranges, per-leaf row counts) is no longer
  in the introspection output. If you need it for a UI surface or a partition
  pruning hint, file a ticket and we'll reopen ADR 0003 — the pre-discussed
  path is to add a sibling `partitions` template and a non-breaking
  schema-v2 minor bump.

## Migrating an existing index

If your AskDB index was built before this change and the database has any
partitioned tables, the schema lock hash will change once on first
re-introspection. Re-run:

```sh
pnpm askdb introspect …
pnpm askdb rag index …
```

Subsequent runs are stable.

## Related

- [ADR 0003 — Postgres partition handling](../adrs/0003-postgres-partition-handling.md)
- [Authoring an AskDB connector](./connectors.md)
- Postgres docs: <https://www.postgresql.org/docs/current/ddl-partitioning.html>
