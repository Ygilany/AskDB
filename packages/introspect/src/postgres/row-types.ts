/**
 * Typed shapes for the rows each template returns. Pairs with
 * `templates.ts`. `coerceRows()` (in describe.ts) maps the executor's
 * `TabularResult` (positional row arrays) into these record shapes by
 * looking up each template's `columns` list — see SqlTemplate.columns.
 */

export type SchemasRow = {
  schema_name: string;
};

export type TablesRow = {
  schema_name: string;
  table_name: string;
  /** "r" base table | "p" partitioned | "v" view | "m" materialized view. */
  relkind: "r" | "p" | "v" | "m";
  row_level_security: boolean;
  comment: string | null;
};

export type ColumnsRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_schema: string;
  udt_name: string;
  is_nullable: boolean;
  default_expression: string | null;
  comment: string | null;
};

export type PrimaryKeysRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  /** 1-based position in the constraint's `conkey`. */
  key_position: number;
  column_name: string;
};

export type ForeignKeysRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  /** 1-based; preserves both `conkey` and `confkey` order (zipped). */
  key_position: number;
  column_name: string;
  referenced_schema_name: string;
  referenced_table_name: string;
  referenced_column_name: string;
  /** pg_constraint.confdeltype: a|r|c|n|d. */
  on_delete_code: string | null;
  /** pg_constraint.confupdtype: a|r|c|n|d. */
  on_update_code: string | null;
};

export type UniqueConstraintsRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  key_position: number;
  column_name: string;
};

export type CheckConstraintsRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  expression: string;
};

export type IndexesRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  is_unique: boolean;
  method: string;
  /** Postgres `text[]` round-trips as a JS array via `pg`. */
  columns: ReadonlyArray<string | null>;
  /** Index expression text (when the index is on an expression). */
  expressions: string | null;
};

export type EnumsRow = {
  schema_name: string;
  enum_name: string;
  enum_position: number;
  enum_value: string;
};

export type SequencesRow = {
  schema_name: string;
  sequence_name: string;
  data_type: string;
  start_value: string;
  minimum_value: string | null;
  maximum_value: string | null;
  increment: string;
  cycle_option: boolean;
};

export type ViewsRow = {
  schema_name: string;
  view_name: string;
  definition: string;
  is_materialized: boolean;
};

export type CommentsRow = {
  object_type: "relation" | "column";
  schema_name: string;
  table_name: string;
  column_name: string | null;
  comment: string | null;
};
