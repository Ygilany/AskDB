import type { AskDbExecutor } from "@askdb/core";

/**
 * Intermediate representation produced by every connector. Renders into a
 * Schema v2 `schema.json`. See docs/specs/phase-6-introspection/requirements.md §2.
 */
export type SqlSchema = {
  schemaId: string;
  schemas: SqlNamespace[];
};

export type SqlNamespace = {
  name: string;
  tables: SqlTable[];
  views: SqlView[];
  enums: SqlEnum[];
  sequences: SqlSequence[];
};

export type SqlTable = {
  /** "table:<schema>.<name>" (or "table:<name>" in public per Schema v2 ID conventions). */
  id: string;
  schema: string;
  name: string;
  /** pg_description-derived; surfaced as informational only. */
  comment?: string;
  columns: SqlColumn[];
  primaryKey?: { columns: string[] };
  /** Ordered by constraint name; column lists preserve `pg_constraint.conkey` order. */
  foreignKeys: SqlForeignKey[];
  uniqueConstraints: SqlUnique[];
  indexes: SqlIndex[];
  /** Captured but not yet emitted into Schema v2. */
  checkConstraints: SqlCheck[];
  rowLevelSecurity?: { enabled: boolean };
};

export type SqlColumn = {
  /** "table:<schema>.<name>#<col>". */
  id: string;
  name: string;
  ordinalPosition: number;
  /** Canonical Postgres type string (e.g. "uuid", "text", "numeric(10,2)", "timestamp with time zone"). */
  dataType: string;
  /** Raw udt_name for arrays / enums. */
  udtName: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultExpression?: string;
  comment?: string;
};

export type SqlForeignKeyAction =
  | "no action"
  | "restrict"
  | "cascade"
  | "set null"
  | "set default";

export type SqlForeignKey = {
  name: string;
  /** Preserves pg_constraint.conkey order — multi-column FK fix. */
  columns: string[];
  references: {
    schema: string;
    table: string;
    /** Preserves pg_constraint.confkey order. */
    columns: string[];
  };
  onDelete?: SqlForeignKeyAction;
  onUpdate?: SqlForeignKeyAction;
};

export type SqlUnique = {
  name: string;
  columns: string[];
};

export type SqlIndex = {
  name: string;
  columns: string[];
  /** Index expression text when the index is on an expression rather than a plain column. */
  expressions?: string[];
  unique: boolean;
  /** pg_am.amname (e.g. "btree", "gin", "gist"). */
  method: string;
};

export type SqlCheck = {
  name: string;
  /** Constraint expression text from pg_get_constraintdef. */
  expression: string;
};

export type SqlEnum = {
  schema: string;
  name: string;
  /** Preserves pg_enum.enumsortorder. */
  values: string[];
};

export type SqlSequence = {
  schema: string;
  name: string;
  dataType: string;
  startValue: string;
  increment: string;
  minValue?: string;
  maxValue?: string;
  cycle: boolean;
};

export type SqlView = {
  schema: string;
  name: string;
  definition: string;
  columns: SqlColumn[];
};

export type IntrospectionFilters = {
  /** Include-list; default `["public"]`. */
  schemas?: string[];
  /**
   * Always excludes `information_schema`, `pg_catalog`, `pg_toast*`, `pg_temp_*`
   * regardless of this list; entries here are additive.
   */
  excludeSchemas?: string[];
  /** Glob patterns; matches against `"<schema>.<name>"`. */
  tables?: string[];
};

export type IntrospectionInput =
  | { mode: "live"; executor: AskDbExecutor; filters?: IntrospectionFilters }
  | { mode: "from-export"; bundlePath: string; filters?: IntrospectionFilters };

export type IntrospectionWarning =
  | { code: "orphan_id"; id: string; file: string }
  | { code: "new_column"; id: string; tableId: string }
  | { code: "unsupported_type"; column: string; type: string }
  | { code: "view_with_array_columns"; view: string; columns: string[] }
  | { code: "ambiguous_filter"; filter: string };

export type IntrospectionResult = {
  schema: SqlSchema;
  warnings: IntrospectionWarning[];
  isEmpty: boolean;
  /** Keyed by `"table:<schema>.<view>"`. */
  viewDefinitions: Record<string, string>;
};

/**
 * Stable identifier for a catalog query template. Used by the air-gapped path
 * to map bundle files (CSV/JSON) to template results.
 *
 * Names mirror requirements.md §4 (Postgres connector — catalog SQL suite).
 */
export type SqlTemplateName =
  | "schemas"
  | "tables"
  | "columns"
  | "primary_keys"
  | "foreign_keys"
  | "unique_constraints"
  | "check_constraints"
  | "indexes"
  | "enums"
  | "sequences"
  | "views"
  | "comments";

export type SqlTemplate = {
  name: SqlTemplateName;
  /**
   * Parameterized SQL string. The connector binds params at run time; the
   * air-gapped front door substitutes filter values into the printed output.
   */
  sql: string;
  /**
   * Stable ordered column list emitted by the SQL — used by the bundle reader
   * to validate CSV headers and to coerce JSON rows.
   */
  columns: readonly string[];
};

export type SqlTemplateBundle = {
  engine: "postgres";
  /** Schema/version of the template suite. Bumped whenever templates change shape. */
  version: number;
  templates: readonly SqlTemplate[];
};

export interface Connector {
  readonly engine: "postgres";
  describe(input: IntrospectionInput): Promise<IntrospectionResult>;
  /** SQL templates for the air-gapped path. */
  templates(): SqlTemplateBundle;
}
