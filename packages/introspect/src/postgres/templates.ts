/**
 * Canonical Postgres catalog SQL suite for `@askdb/introspect`.
 *
 * Every template:
 *   - Has an explicit `ORDER BY` so result ordering is byte-stable across runs.
 *   - Filters out system schemas (`information_schema`, `pg_catalog`, `pg_toast*`,
 *     `pg_temp_*`) at the source. The connector additionally applies
 *     `IntrospectionFilters` (include/exclude lists, table glob).
 *   - Uses `pg_catalog` primarily for accuracy and `format_type()` for human-
 *     friendly type strings.
 *
 * Determinism guarantees called out in spec (requirements.md §4):
 *   - Multi-column foreign keys preserve `pg_constraint.conkey` order on the
 *     local side and `pg_constraint.confkey` order on the referenced side
 *     (regression guard for the documented Drizzle bug).
 *   - Enum values preserve `pg_enum.enumsortorder`.
 *
 * Filter parameter convention:
 *   - `$1` is `text[]` of include schemas (NULL → no include filter).
 *   - `$2` is `text[]` of exclude schemas (additive on top of system excludes).
 *
 * Table-name glob filtering (`IntrospectionFilters.tables`) is applied in the
 * connector after rows arrive — keeping the SQL agnostic of glob syntax.
 */

import type { SqlTemplate, SqlTemplateBundle } from "../types.js";

const SYSTEM_SCHEMA_PREDICATE = `
  n.nspname NOT IN ('information_schema', 'pg_catalog')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND n.nspname NOT LIKE 'pg_toast_temp_%'
`.trim();

const FILTER_PREDICATE = `
  ($1::text[] IS NULL OR n.nspname = ANY($1::text[]))
  AND ($2::text[] IS NULL OR NOT (n.nspname = ANY($2::text[])))
`.trim();

const SCHEMAS_TEMPLATE: SqlTemplate = {
  name: "schemas",
  columns: ["schema_name"],
  sql: `
SELECT n.nspname AS schema_name
FROM pg_catalog.pg_namespace n
WHERE ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname;
`.trim(),
};

const TABLES_TEMPLATE: SqlTemplate = {
  name: "tables",
  columns: [
    "schema_name",
    "table_name",
    "relkind",
    "row_level_security",
    "comment",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind::text AS relkind,
  c.relrowsecurity AS row_level_security,
  pg_catalog.obj_description(c.oid, 'pg_class') AS comment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname;
`.trim(),
};

const COLUMNS_TEMPLATE: SqlTemplate = {
  name: "columns",
  columns: [
    "schema_name",
    "table_name",
    "column_name",
    "ordinal_position",
    "data_type",
    "udt_schema",
    "udt_name",
    "is_nullable",
    "default_expression",
    "comment",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attname AS column_name,
  a.attnum AS ordinal_position,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  tn.nspname AS udt_schema,
  t.typname AS udt_name,
  NOT a.attnotnull AS is_nullable,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
  pg_catalog.col_description(c.oid, a.attnum) AS comment
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, a.attnum;
`.trim(),
};

const PRIMARY_KEYS_TEMPLATE: SqlTemplate = {
  name: "primary_keys",
  columns: [
    "schema_name",
    "table_name",
    "constraint_name",
    "key_position",
    "column_name",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  k.ord AS key_position,
  a.attname AS column_name
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
WHERE con.contype = 'p'
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, con.conname, k.ord;
`.trim(),
};

/**
 * Foreign keys — the multi-column FK regression guard lives here. `conkey`
 * preserves the local column order; `confkey` preserves the referenced column
 * order. We unnest both with `WITH ORDINALITY` so the connector can rebuild
 * the column lists in the constraint's declared order even after row sorting.
 *
 * `confdeltype`/`confupdtype` action codes (per pg_constraint.h):
 *   a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL, d=SET DEFAULT
 */
const FOREIGN_KEYS_TEMPLATE: SqlTemplate = {
  name: "foreign_keys",
  columns: [
    "schema_name",
    "table_name",
    "constraint_name",
    "key_position",
    "column_name",
    "referenced_schema_name",
    "referenced_table_name",
    "referenced_column_name",
    "on_delete_code",
    "on_update_code",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  k.ord AS key_position,
  a.attname AS column_name,
  rn.nspname AS referenced_schema_name,
  rc.relname AS referenced_table_name,
  ra.attname AS referenced_column_name,
  con.confdeltype::text AS on_delete_code,
  con.confupdtype::text AS on_update_code
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, refattnum, ord)
JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
JOIN pg_catalog.pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refattnum
WHERE con.contype = 'f'
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, con.conname, k.ord;
`.trim(),
};

const UNIQUE_CONSTRAINTS_TEMPLATE: SqlTemplate = {
  name: "unique_constraints",
  columns: [
    "schema_name",
    "table_name",
    "constraint_name",
    "key_position",
    "column_name",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  k.ord AS key_position,
  a.attname AS column_name
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
WHERE con.contype = 'u'
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, con.conname, k.ord;
`.trim(),
};

const CHECK_CONSTRAINTS_TEMPLATE: SqlTemplate = {
  name: "check_constraints",
  columns: ["schema_name", "table_name", "constraint_name", "expression"],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS expression
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'c'
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, con.conname;
`.trim(),
};

const INDEXES_TEMPLATE: SqlTemplate = {
  name: "indexes",
  columns: [
    "schema_name",
    "table_name",
    "index_name",
    "is_unique",
    "method",
    "columns",
    "expressions",
  ],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  ic.relname AS index_name,
  i.indisunique AS is_unique,
  am.amname AS method,
  ARRAY(
    SELECT a.attname
    FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    ORDER BY k.ord
  ) AS columns,
  pg_catalog.pg_get_expr(i.indexprs, i.indrelid) AS expressions
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_am am ON am.oid = ic.relam
WHERE NOT i.indisprimary
  AND c.relkind IN ('r', 'p', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname, ic.relname;
`.trim(),
};

const ENUMS_TEMPLATE: SqlTemplate = {
  name: "enums",
  columns: ["schema_name", "enum_name", "enum_position", "enum_value"],
  sql: `
SELECT
  n.nspname AS schema_name,
  t.typname AS enum_name,
  e.enumsortorder AS enum_position,
  e.enumlabel AS enum_value
FROM pg_catalog.pg_type t
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
WHERE t.typtype = 'e'
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, t.typname, e.enumsortorder, e.enumlabel;
`.trim(),
};

const SEQUENCES_TEMPLATE: SqlTemplate = {
  name: "sequences",
  columns: [
    "schema_name",
    "sequence_name",
    "data_type",
    "start_value",
    "minimum_value",
    "maximum_value",
    "increment",
    "cycle_option",
  ],
  sql: `
SELECT
  s.schemaname AS schema_name,
  s.sequencename AS sequence_name,
  s.data_type::text AS data_type,
  s.start_value::text AS start_value,
  s.min_value::text AS minimum_value,
  s.max_value::text AS maximum_value,
  s.increment_by::text AS increment,
  s.cycle AS cycle_option
FROM pg_catalog.pg_sequences s
JOIN pg_catalog.pg_namespace n ON n.nspname = s.schemaname
WHERE ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY s.schemaname, s.sequencename;
`.trim(),
};

const VIEWS_TEMPLATE: SqlTemplate = {
  name: "views",
  columns: ["schema_name", "view_name", "definition", "is_materialized"],
  sql: `
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  pg_catalog.pg_get_viewdef(c.oid, true) AS definition,
  (c.relkind = 'm') AS is_materialized
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY n.nspname, c.relname;
`.trim(),
};

/**
 * Comments template — table/column comments are already returned inline by
 * `tables` and `columns` templates, but this template gives the air-gapped
 * path a uniform export and lets future enrichment surface object comments
 * for things outside tables (e.g. schemas, functions). Only object types we
 * currently consume (`relation`, `column`) are included.
 */
const COMMENTS_TEMPLATE: SqlTemplate = {
  name: "comments",
  columns: [
    "object_type",
    "schema_name",
    "table_name",
    "column_name",
    "comment",
  ],
  sql: `
SELECT
  'relation'::text AS object_type,
  n.nspname AS schema_name,
  c.relname AS table_name,
  NULL::text AS column_name,
  d.description AS comment
FROM pg_catalog.pg_description d
JOIN pg_catalog.pg_class c ON c.oid = d.objoid AND d.objsubid = 0
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
UNION ALL
SELECT
  'column'::text AS object_type,
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attname AS column_name,
  d.description AS comment
FROM pg_catalog.pg_description d
JOIN pg_catalog.pg_class c ON c.oid = d.objoid
JOIN pg_catalog.pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE d.objsubid > 0
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND ${SYSTEM_SCHEMA_PREDICATE}
  AND ${FILTER_PREDICATE}
ORDER BY 1, 2, 3, 4;
`.trim(),
};

/**
 * Bumped whenever the suite's template names or column lists change shape.
 * The air-gapped path's `manifest.json` carries the same number so bundle
 * readers can refuse mismatched exports.
 */
export const POSTGRES_TEMPLATE_VERSION = 1;

export const POSTGRES_TEMPLATES: readonly SqlTemplate[] = [
  SCHEMAS_TEMPLATE,
  TABLES_TEMPLATE,
  COLUMNS_TEMPLATE,
  PRIMARY_KEYS_TEMPLATE,
  FOREIGN_KEYS_TEMPLATE,
  UNIQUE_CONSTRAINTS_TEMPLATE,
  CHECK_CONSTRAINTS_TEMPLATE,
  INDEXES_TEMPLATE,
  ENUMS_TEMPLATE,
  SEQUENCES_TEMPLATE,
  VIEWS_TEMPLATE,
  COMMENTS_TEMPLATE,
] as const;

export const POSTGRES_TEMPLATE_BUNDLE: SqlTemplateBundle = {
  engine: "postgres",
  version: POSTGRES_TEMPLATE_VERSION,
  templates: POSTGRES_TEMPLATES,
};

export function findTemplate(name: SqlTemplate["name"]): SqlTemplate {
  const t = POSTGRES_TEMPLATES.find((tpl) => tpl.name === name);
  if (!t) {
    throw new Error(`@askdb/introspect/postgres: unknown template '${name}'`);
  }
  return t;
}

/** Postgres FK action codes from pg_constraint (`confdeltype`/`confupdtype`). */
export const PG_FK_ACTION_BY_CODE: Readonly<Record<string, string>> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};
