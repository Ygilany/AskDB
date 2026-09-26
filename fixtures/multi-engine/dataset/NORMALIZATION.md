# Multi-engine fixture: dataset and normalization rules

The fixture holds one logical dataset in five engines. The engines disagree on how to store and return the same logical value, so every comparison normalizes first. The value rules are implemented in [`src/normalize.ts`](../src/normalize.ts) and the schema-comparison rules in [`src/schema-compare.ts`](../src/schema-compare.ts); keep them in sync with this file.

## Sources of truth

| File | Role |
|---|---|
| `schema.logical.json` | The golden logical schema: tables, columns, logical types, nullability, primary keys, composite foreign keys (in column order), unique constraints, the view, and tenant and sensitive tags. |
| `data/<schema>.<table>.json` | The rows, with logical values: ISO dates, `YYYY-MM-DDTHH:MM:SS` timestamps (naive UTC), decimals as strings, booleans as JSON booleans. |
| `ddl/<dialect>.sql` | Hand-written DDL per engine. It must implement `schema.logical.json` exactly. |

The seeder (`src/seed.ts`) loads the JSON into every engine. `test/dataset.integration.test.ts` proves each engine holds exactly those rows after normalization.

## Logical schemas per engine

| Engine | Mapping |
|---|---|
| Postgres, SQL Server | Real schemas `org`, `people`, `billing`, `ref` in database `askdb_fixture`. |
| MySQL, MariaDB | One database per logical schema: `org`, `people`, `billing`, `ref`. Connections default to `org`, and cross-database references are qualified (`billing.order_line`). |
| SQLite | Everything in `main`, which AskDB renders as namespace `public`. Logical table names are unique across logical schemas, so each table maps back to its logical schema through `schema.logical.json`. |

The seeder's dataset hash lives outside the logical schemas: a `fixture` schema (Postgres, SQL Server), a `fixture` database (MySQL/MariaDB), or a sidecar file `multi-engine.sqlite.hash` (SQLite). A filtered introspection (`--schemas org,people,billing,ref`) never sees it.

Postgres alone partitions `billing.payment` (by `paid_on`, with 2024, 2025 and default partitions). The logical schema, and therefore every engine, has only `billing.payment`; the partition leaves must not appear in introspection (ADR 0003).

## Value rules

| Logical type | Postgres | MySQL / MariaDB | SQL Server | SQLite | Normalized value |
|---|---|---|---|---|---|
| `int` | `integer` | `INT` | `INT` | `INTEGER` | Integer string. |
| `bigint` (counts) | `bigint`, which `pg` returns as a string | `BIGINT` | `INT`/`BIGINT` | `INTEGER` | Integer string. |
| `decimal(p,s)` | `numeric(p,s)`, returned as a string | `DECIMAL(p,s)`, returned as a string | `DECIMAL(p,s)`, returned as a number | declared `DECIMAL(p,s)`; NUMERIC affinity stores REAL/INTEGER | Rounded half-up to 6 places, trailing zeros removed: `12.50` → `12.5`, `3.00` → `3`. Rounding absorbs float noise from SQLite's REAL storage and long `AVG` results. |
| `boolean` | `boolean` | `BOOLEAN` = `TINYINT(1)`, returned as `0`/`1` | `BIT`, returned as a boolean | declared `BOOLEAN`, stored `0`/`1` | `true`/`false`. Applied only where the column is declared `boolean`: at the driver level a MySQL `TINYINT(1)` is just an integer. |
| `date` | `date` | `DATE` | `DATE` | `DATE` (ISO text) | `YYYY-MM-DD`. The fixture reads Postgres and MySQL dates as raw strings, and converts SQL Server `Date` objects in UTC, so nothing shifts by the local timezone. |
| `timestamp` | `timestamp` | `DATETIME` | `DATETIME2(0)` | `TIMESTAMP` (`YYYY-MM-DD HH:MM:SS` text) | `YYYY-MM-DDTHH:MM:SS`. Tests run with `TZ=UTC`. |
| `text(n)` | `varchar(n)` | `VARCHAR(n)`, `utf8mb4` | `NVARCHAR(n)` | `VARCHAR(n)` (TEXT affinity) | Unicode NFC. Length is not compared. |

`NULL` is always `null`.

## Result-set rules

- Columns are compared **by position**. Column labels are ignored: alias case differs across engines (Postgres folds unquoted aliases to lower case) and across models.
- Rows are compared as a **multiset** (sorted after normalization) unless a scenario declares `ordered: true`. An ordered scenario must `ORDER BY` a unique numeric key, because each engine's default collation orders strings differently.
- Collations are each engine's default, as a real user's would be. MySQL, MariaDB and SQL Server compare strings case-insensitively by default; Postgres and SQLite do not. A scenario whose answer depends on that is marked dialect-sensitive and compared to a per-dialect expectation rather than across dialects. For the same reason, the dataset contains no values that differ only by case: a unique constraint on such values would fail on the case-insensitive engines.
- Integer averages differ by engine (SQL Server's `AVG(int)` returns an integer). A scenario that averages integers must cast in its expected SQL; a mismatch from that is a dataset/normalization issue, not a product bug.

## Schema-comparison rules

Used by the package introspection suites (and the consumer lab) to compare an introspected Schema v2 artifact with `schema.logical.json`.

- Compared: tables, columns, normalized types, `nullable`, `primaryKey`, and relationships (`from`/`to` column ids, as an ordered list per composite foreign key).
- Identifiers are compared case-insensitively. Namespaces must equal the logical schemas on engines that expose them (Postgres, SQL Server, multi-database MySQL/MariaDB); SQLite's single namespace is mapped back by table name.
- Any table the golden schema doesn't list (a partition leaf, the seeder's `fixture_meta`) is a difference.
- Native types map to logical types by the value-rules table, in the direction native → logical (`normalizeNativeType`); a type the rules don't cover is a difference.
- **Not comparable:** Schema v2 has no unique constraints, indexes or view marker; a view renders as an ordinary table entry. Those facts stay in `schema.logical.json` for DDL review; the comparison skips them.
- **View columns:** only names and order are compared. Engines derive view column types and nullability differently (Postgres reports every view column nullable; SQL Server's `COUNT(*)` is `int`, Postgres's is `bigint`).
