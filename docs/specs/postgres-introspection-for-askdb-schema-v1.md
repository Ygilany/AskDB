# Postgres introspection → AskDB schema JSON v1 (Phase 5 direction)

## Approach (no live DB required in AskDB)

AskDB does **not** need a network path into the customer database for this workflow.

1. **Run documented SQL** in the customer’s own tools (`psql`, DBeaver, CI export, etc.) against **`information_schema`** (and optionally **`pg_catalog`** for Postgres-specific details later).
2. **Save results** as CSV, JSON, or paste-friendly rows.
3. **Feed that export** into a future AskDB **converter** (CLI subcommand or web import) that emits **`AskDB schema JSON v1`** — same shape as [`fixtures/schemas/README.md`](../../fixtures/schemas/README.md).

An optional later enhancement is a **live connector** that runs the same queries from AskDB; it is **not** required for Phase 5.

## Multi-schema tables

AskDB schema v1 uses a single string **`name`** per table. For objects outside `public`, use a stable convention such as **`schema_name.table_name`** so NL→SQL prompts stay unambiguous.

## Reference queries (PostgreSQL)

Filters exclude system catalogs: `information_schema`, `pg_catalog`.

### List schemas (optional)

Useful to decide which schemas to include before building the artifact.

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
ORDER BY schema_name;
```

### List tables (optional)

```sql
SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
ORDER BY table_schema, table_name;
```

Restrict to physical tables with `AND table_type = 'BASE TABLE'` when views should be excluded.

### Columns + primary key flag (recommended unified extract)

One result set suitable for driving **`tables[].columns[]`** (`name`, `type`, `nullable`, `primaryKey`).  
Map Postgres `data_type` / `udt_name` (+ length/precision) to a single display **`type`** string in the converter.

```sql
SELECT
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.character_maximum_length,
  c.numeric_precision,
  c.numeric_scale,
  c.datetime_precision,
  c.is_nullable,
  c.column_default,
  CASE
    WHEN pk.column_name IS NOT NULL THEN true
    ELSE false
  END AS is_primary_key
FROM information_schema.columns c
LEFT JOIN (
  SELECT
    kcu.table_schema,
    kcu.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
   AND tc.table_name = kcu.table_name
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk
  ON c.table_schema = pk.table_schema
 AND c.table_name = pk.table_name
 AND c.column_name = pk.column_name
WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
ORDER BY c.table_schema, c.table_name, c.ordinal_position;
```

### Foreign keys (optional)

AskDB schema JSON v1 today does **not** model FK edges; this query is useful for **documentation**, future schema versions, or enrichment UX — not required for minimal v1 conversion.

```sql
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema NOT IN ('information_schema', 'pg_catalog')
ORDER BY tc.table_schema, tc.table_name, kcu.column_name;
```

## Converter contract (to be implemented)

- **Input:** Row-oriented export(s) from the queries above (format TBD: e.g. concatenated CSVs with table markers, or single unified CSV + metadata).
- **Output:** Valid **`{ "version": 1, "tables": [ ... ] }`** per [`packages/core/src/schema/format.ts`](../../packages/core/src/schema/format.ts).
- **Type mapping:** Normalize Postgres `data_type` / `udt_name` / modifiers into the **string** `type` field AskDB expects (exact mapping table lives with the converter implementation).

## References

- [`docs/roadmap.md`](../roadmap.md) — Phase 5  
- [`fixtures/schemas/README.md`](../../fixtures/schemas/README.md) — AskDB schema JSON v1  
