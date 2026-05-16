import type {
  CatalogQueryRunner,
  IntrospectionFilters,
  IntrospectionResult,
  IntrospectionWarning,
  SqlColumn,
  SqlForeignKey,
  SqlForeignKeyAction,
  SqlIndex,
  SqlNamespace,
  SqlSchema,
  SqlTable,
  SqlUnique,
  SqlView,
} from "@askdb/introspect";
import { compileTableFilters } from "./glob.js";
import { makeColumnId, makeTableId } from "./ids.js";

/**
 * System schemas excluded from the default introspection.
 * Honors the engine-agnostic `excludeSchemas` filter additively.
 */
const DEFAULT_SYSTEM_SCHEMAS = new Set<string>([
  "sys",
  "INFORMATION_SCHEMA",
  "db_owner",
  "db_accessadmin",
  "db_securityadmin",
  "db_ddladmin",
  "db_backupoperator",
  "db_datareader",
  "db_datawriter",
  "db_denydatareader",
  "db_denydatawriter",
  "guest",
]);

export type DescribeSqlServerInput = {
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

// sys.* catalog queries. Tables/views, columns (no comments/defaults yet —
// follow-up), PKs + UNIQUE constraints via sys.indexes, FKs via sys.foreign_keys,
// non-PK/non-UNIQUE indexes for completeness.

const SQL_TABLES = `SELECT
  s.name AS schema_name,
  t.name AS table_name,
  'BASE TABLE' AS table_type
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
UNION ALL
SELECT
  s.name AS schema_name,
  v.name AS table_name,
  'VIEW' AS table_type
FROM sys.views v
JOIN sys.schemas s ON s.schema_id = v.schema_id
ORDER BY schema_name, table_name`;

const SQL_VIEWS = `SELECT
  s.name AS schema_name,
  v.name AS view_name,
  m.definition AS view_definition
FROM sys.views v
JOIN sys.schemas s ON s.schema_id = v.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id
ORDER BY s.name, v.name`;

const SQL_COLUMNS = `SELECT
  s.name AS schema_name,
  o.name AS table_name,
  c.name AS column_name,
  c.column_id AS ordinal_position,
  typ.name AS type_name,
  c.max_length AS max_length,
  c.precision AS precision_v,
  c.scale AS scale,
  c.is_nullable AS is_nullable
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.types typ ON typ.user_type_id = c.user_type_id
WHERE o.type IN ('U','V')
ORDER BY s.name, o.name, c.column_id`;

const SQL_CONSTRAINTS = `SELECT
  s.name AS schema_name,
  t.name AS table_name,
  i.name AS constraint_name,
  c.name AS column_name,
  ic.key_ordinal AS ordinal_position,
  CASE WHEN i.is_primary_key = 1 THEN 'PRIMARY KEY' ELSE 'UNIQUE' END AS constraint_type
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE (i.is_primary_key = 1 OR i.is_unique_constraint = 1)
  AND ic.is_included_column = 0
ORDER BY s.name, t.name, i.name, ic.key_ordinal`;

const SQL_FOREIGN_KEYS = `SELECT
  s.name AS schema_name,
  pt.name AS table_name,
  fk.name AS constraint_name,
  pc.name AS column_name,
  fkc.constraint_column_id AS ordinal_position,
  rs.name AS referenced_schema,
  rt.name AS referenced_table,
  rc.name AS referenced_column,
  fk.update_referential_action AS update_action,
  fk.delete_referential_action AS delete_action
FROM sys.foreign_keys fk
JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
JOIN sys.schemas s ON s.schema_id = pt.schema_id
JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY s.name, pt.name, fk.name, fkc.constraint_column_id`;

const SQL_INDEXES = `SELECT
  s.name AS schema_name,
  t.name AS table_name,
  i.name AS index_name,
  c.name AS column_name,
  ic.key_ordinal AS ordinal_position,
  i.is_unique AS is_unique,
  i.type_desc AS method
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.is_primary_key = 0
  AND i.is_unique_constraint = 0
  AND i.name IS NOT NULL
  AND ic.is_included_column = 0
ORDER BY s.name, t.name, i.name, ic.key_ordinal`;

/** Internal: the catalog SQL strings, exposed for snapshot-based tests. */
export const SQLSERVER_CATALOG_SQL = {
  tables: SQL_TABLES,
  views: SQL_VIEWS,
  columns: SQL_COLUMNS,
  constraints: SQL_CONSTRAINTS,
  foreign_keys: SQL_FOREIGN_KEYS,
  indexes: SQL_INDEXES,
} as const;

type TableRow = {
  schema_name: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
};
type ViewRow = {
  schema_name: string;
  view_name: string;
  view_definition: string | null;
};
type ColumnRow = {
  schema_name: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  type_name: string;
  max_length: number;
  precision_v: number;
  scale: number;
  is_nullable: 0 | 1 | boolean;
};
type ConstraintRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  column_name: string;
  ordinal_position: number;
  constraint_type: "PRIMARY KEY" | "UNIQUE";
};
type ForeignKeyRow = {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  column_name: string;
  ordinal_position: number;
  referenced_schema: string;
  referenced_table: string;
  referenced_column: string;
  update_action: number;
  delete_action: number;
};
type IndexRow = {
  schema_name: string;
  table_name: string;
  index_name: string;
  column_name: string;
  ordinal_position: number;
  is_unique: 0 | 1 | boolean;
  method: string;
};

export async function describeSqlServer(input: DescribeSqlServerInput): Promise<IntrospectionResult> {
  const runner = input.runner;
  const tableFilter = compileTableFilters(input.filters?.tables);

  const run = async <T>(sql: string): Promise<T[]> => {
    const result = await runner(sql);
    if (result.rows.length === 0) return [];
    const idx = new Map<string, number>();
    for (let i = 0; i < result.columns.length; i++) idx.set(result.columns[i]!, i);
    return result.rows.map((row) => {
      const record: Record<string, unknown> = {};
      for (const [name, i] of idx) record[name] = row[i];
      return record as T;
    });
  };

  const [tableRows, viewRows, columnRows, constraintRows, fkRows, indexRows] = await Promise.all([
    run<TableRow>(SQL_TABLES),
    run<ViewRow>(SQL_VIEWS),
    run<ColumnRow>(SQL_COLUMNS),
    run<ConstraintRow>(SQL_CONSTRAINTS),
    run<ForeignKeyRow>(SQL_FOREIGN_KEYS),
    run<IndexRow>(SQL_INDEXES),
  ]);

  return foldSqlServerResult({
    schemaId: input.schemaId ?? "introspected",
    tableFilter,
    includeSchemas: input.filters?.schemas,
    excludeSchemas: input.filters?.excludeSchemas ?? [],
    tableRows,
    viewRows,
    columnRows,
    constraintRows,
    fkRows,
    indexRows,
    declaredFilters: input.filters?.tables ?? [],
  });
}

type FoldInput = {
  schemaId: string;
  tableFilter: ReturnType<typeof compileTableFilters>;
  includeSchemas: ReadonlyArray<string> | undefined;
  excludeSchemas: ReadonlyArray<string>;
  tableRows: TableRow[];
  viewRows: ViewRow[];
  columnRows: ColumnRow[];
  constraintRows: ConstraintRow[];
  fkRows: ForeignKeyRow[];
  indexRows: IndexRow[];
  declaredFilters: ReadonlyArray<string>;
};

export function foldSqlServerResult(input: FoldInput): IntrospectionResult {
  const warnings: IntrospectionWarning[] = [];
  const includeSet = input.includeSchemas ? new Set(input.includeSchemas) : undefined;
  const excludeSet = new Set(input.excludeSchemas);
  const includes = (schemaName: string): boolean => {
    if (DEFAULT_SYSTEM_SCHEMAS.has(schemaName)) return false;
    if (excludeSet.has(schemaName)) return false;
    if (includeSet && !includeSet.has(schemaName)) return false;
    return true;
  };

  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of input.columnRows) {
    if (!includes(c.schema_name)) continue;
    const key = `${c.schema_name}.${c.table_name}`;
    const list = colsByTable.get(key) ?? [];
    list.push(c);
    colsByTable.set(key, list);
  }
  const constraintsByTable = groupByQualified(input.constraintRows, includes);
  const fksByTable = groupByQualified(input.fkRows, includes);
  const indexesByTable = groupByQualified(input.indexRows, includes);
  const viewDefByQualified = new Map<string, string>();
  for (const v of input.viewRows) {
    if (!includes(v.schema_name)) continue;
    if (v.view_definition) viewDefByQualified.set(`${v.schema_name}.${v.view_name}`, v.view_definition);
  }

  const tablesBySchema = new Map<string, SqlTable[]>();
  const viewsBySchema = new Map<string, SqlView[]>();
  const viewDefinitions: Record<string, string> = {};

  for (const t of input.tableRows) {
    if (!includes(t.schema_name)) continue;
    const qualified = `${t.schema_name}.${t.table_name}`;
    if (!input.tableFilter(qualified)) continue;

    const cols = (colsByTable.get(qualified) ?? [])
      .slice()
      .sort((a, b) => a.ordinal_position - b.ordinal_position);
    const constraints = constraintsByTable.get(qualified) ?? [];
    const pkRows = constraints
      .filter((c) => c.constraint_type === "PRIMARY KEY")
      .sort((a, b) => a.ordinal_position - b.ordinal_position);
    const pkColumns = pkRows.map((r) => r.column_name);
    const pkSet = new Set(pkColumns);

    const columns: SqlColumn[] = cols.map((c) =>
      buildColumn(t.schema_name, t.table_name, c, pkSet),
    );

    if (t.table_type === "VIEW") {
      const def = viewDefByQualified.get(qualified) ?? "";
      const list = viewsBySchema.get(t.schema_name) ?? [];
      list.push({
        schema: t.schema_name,
        name: t.table_name,
        definition: def,
        columns,
      });
      viewsBySchema.set(t.schema_name, list);
      viewDefinitions[makeTableId(t.schema_name, t.table_name)] = def;
      continue;
    }

    const list = tablesBySchema.get(t.schema_name) ?? [];
    list.push({
      id: makeTableId(t.schema_name, t.table_name),
      schema: t.schema_name,
      name: t.table_name,
      comment: undefined,
      columns,
      primaryKey: pkColumns.length > 0 ? { columns: pkColumns } : undefined,
      foreignKeys: buildForeignKeys(fksByTable.get(qualified) ?? []),
      uniqueConstraints: buildUniques(constraints),
      indexes: buildIndexes(indexesByTable.get(qualified) ?? []),
      checkConstraints: [],
    });
    tablesBySchema.set(t.schema_name, list);
  }

  const schemaNames = sortedUnique([
    ...tablesBySchema.keys(),
    ...viewsBySchema.keys(),
  ]);
  const namespaces: SqlNamespace[] = schemaNames.map((name) => ({
    name,
    tables: (tablesBySchema.get(name) ?? []).slice().sort(byName),
    views: (viewsBySchema.get(name) ?? []).slice().sort(byName),
    enums: [],
    sequences: [],
  }));

  for (const pattern of input.declaredFilters) {
    const matched = namespaces.some(
      (ns) =>
        ns.tables.some((t) => compileTableFilters([pattern])(`${ns.name}.${t.name}`)) ||
        ns.views.some((v) => compileTableFilters([pattern])(`${ns.name}.${v.name}`)),
    );
    if (!matched) warnings.push({ code: "ambiguous_filter", filter: pattern });
  }

  const schema: SqlSchema = { schemaId: input.schemaId, schemas: namespaces };
  const isEmpty = namespaces.length === 0;
  return { schema, warnings, isEmpty, viewDefinitions, provider: "sqlserver" };
}

function buildColumn(
  schemaName: string,
  tableName: string,
  c: ColumnRow,
  pkSet: Set<string>,
): SqlColumn {
  // Render a precision-aware type string for the prompt — e.g. `nvarchar(255)`,
  // `decimal(10,2)`. `max_length` is in bytes; for nvarchar/nchar it's 2 × chars
  // (we surface bytes here; consumers don't need the unit).
  const dataType = renderType(c);
  return {
    id: makeColumnId(schemaName, tableName, c.column_name),
    name: c.column_name,
    ordinalPosition: c.ordinal_position,
    dataType,
    udtName: c.type_name,
    nullable: c.is_nullable === 1 || c.is_nullable === true,
    primaryKey: pkSet.has(c.column_name),
    defaultExpression: undefined,
    comment: undefined,
  };
}

function renderType(c: ColumnRow): string {
  const t = c.type_name.toLowerCase();
  if (t === "decimal" || t === "numeric") return `${c.type_name}(${c.precision_v},${c.scale})`;
  if (t === "char" || t === "varchar" || t === "binary" || t === "varbinary") {
    return c.max_length === -1 ? `${c.type_name}(max)` : `${c.type_name}(${c.max_length})`;
  }
  if (t === "nchar" || t === "nvarchar") {
    if (c.max_length === -1) return `${c.type_name}(max)`;
    // nchar/nvarchar max_length is bytes (= 2 × chars).
    return `${c.type_name}(${Math.floor(c.max_length / 2)})`;
  }
  return c.type_name;
}

function buildUniques(rows: ConstraintRow[]): SqlUnique[] {
  const byName = new Map<string, ConstraintRow[]>();
  for (const r of rows) {
    if (r.constraint_type !== "UNIQUE") continue;
    const list = byName.get(r.constraint_name) ?? [];
    list.push(r);
    byName.set(r.constraint_name, list);
  }
  return Array.from(byName, ([name, list]) => ({
    name,
    columns: list
      .slice()
      .sort((a, b) => a.ordinal_position - b.ordinal_position)
      .map((r) => r.column_name),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function buildForeignKeys(rows: ForeignKeyRow[]): SqlForeignKey[] {
  const byName = new Map<string, ForeignKeyRow[]>();
  for (const r of rows) {
    const list = byName.get(r.constraint_name) ?? [];
    list.push(r);
    byName.set(r.constraint_name, list);
  }
  const fks: SqlForeignKey[] = [];
  for (const [name, list] of byName) {
    const ordered = list.slice().sort((a, b) => a.ordinal_position - b.ordinal_position);
    const sample = ordered[0]!;
    fks.push({
      name,
      columns: ordered.map((r) => r.column_name),
      references: {
        schema: sample.referenced_schema,
        table: sample.referenced_table,
        columns: ordered.map((r) => r.referenced_column),
      },
      onDelete: mapAction(sample.delete_action),
      onUpdate: mapAction(sample.update_action),
    });
  }
  return fks.sort((a, b) => a.name.localeCompare(b.name));
}

function mapAction(code: number): SqlForeignKeyAction | undefined {
  switch (code) {
    case 0:
      return "no action";
    case 1:
      return "cascade";
    case 2:
      return "set null";
    case 3:
      return "set default";
    default:
      return undefined;
  }
}

function buildIndexes(rows: IndexRow[]): SqlIndex[] {
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows) {
    const list = byName.get(r.index_name) ?? [];
    list.push(r);
    byName.set(r.index_name, list);
  }
  return Array.from(byName, ([name, list]) => {
    const ordered = list.slice().sort((a, b) => a.ordinal_position - b.ordinal_position);
    const sample = ordered[0]!;
    return {
      name,
      columns: ordered.map((r) => r.column_name),
      unique: sample.is_unique === 1 || sample.is_unique === true,
      method: sample.method,
    } satisfies SqlIndex;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function groupByQualified<T extends { schema_name: string; table_name: string }>(
  rows: T[],
  includes: (schemaName: string) => boolean,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (!includes(r.schema_name)) continue;
    const key = `${r.schema_name}.${r.table_name}`;
    const list = out.get(key) ?? [];
    list.push(r);
    out.set(key, list);
  }
  return out;
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}
