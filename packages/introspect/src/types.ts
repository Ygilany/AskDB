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
  /** Include-list; defaults to all non-system schemas when omitted. */
  schemas?: string[];
  /**
   * Always excludes `information_schema`, `pg_catalog`, `pg_toast*`, `pg_temp_*`
   * regardless of this list; entries here are additive.
   */
  excludeSchemas?: string[];
  /** Glob patterns; matches against `"<schema>.<name>"`. */
  tables?: string[];
};

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
  /**
   * Optional SQL dialect identifier the connector inferred for this source.
   * Live connectors set this from the engine they connect to; schema-file
   * connectors (e.g. `@askdb/prisma`) set it from the declared `datasource.provider`.
   *
   * Hosts may use this to auto-select the NL→SQL dialect when the user has not
   * specified one explicitly. The string matches `@askdb/core`'s `DialectId`
   * (e.g. `"postgres"`, `"mysql"`, `"sqlite"`, `"sqlserver"`, `"cockroachdb"`).
   * Kept loose here to avoid a cross-package import for a stable string set.
   */
  provider?: string;
};

/**
 * Generic catalog query template. Integration packages (e.g. `@askdb/postgres`) own the
 * concrete set of template names; the engine-agnostic introspect package treats names as
 * opaque strings used for bundle-file mapping and header validation.
 */
export type SqlTemplate = {
  name: string;
  /** Parameterized SQL string. The connector binds params at run time. */
  sql: string;
  /**
   * Stable ordered column list emitted by the SQL — used by the bundle reader
   * to validate CSV headers and to coerce JSON rows.
   */
  columns: readonly string[];
};

export type SqlTemplateBundle = {
  /** Engine identifier (e.g. `"postgres"`, `"mysql"`). Set by the integration package. */
  engine: string;
  /** Schema/version of the template suite. Bumped whenever templates change shape. */
  version: number;
  templates: readonly SqlTemplate[];
};

/**
 * Row shape returned by a connector's catalog query runner.
 *
 * This is intentionally scoped to introspection. It is for connector-owned
 * catalog templates, not for running generated user SQL.
 */
export type CatalogQueryResult = {
  columns: string[];
  rows: unknown[][];
};

/**
 * Introspection-only query port used by live connectors to run documented
 * catalog SQL templates.
 */
export type CatalogQueryRunner = (
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<CatalogQueryResult>;

/**
 * Engine-agnostic introspection connector. Each integration package (`@askdb/postgres`,
 * a future `@askdb/mysql`, `@askdb/prisma`, ...) exports its own connector and its own
 * input shape; the introspect orchestrator just hands the input through.
 *
 * `templates()` is optional — integrations like Prisma that read schema files do not have
 * a catalog template suite.
 */
export interface Connector<TInput = unknown> {
  describe(input: TInput): Promise<IntrospectionResult>;
  templates?(): SqlTemplateBundle;
}
