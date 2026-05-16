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
 * MySQL doesn't have Postgres-style schemas (each "schema" is a database).
 * Hosts pick a database via the connection string; the connector emits its
 * contents under a single namespace named `"public"` to match `@askdb/prisma`'s
 * convention and keep table ids cross-engine stable.
 */
const NAMESPACE = "public";

export type DescribeMysqlInput = {
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

// information_schema is well-documented; pinning the SQL inside the package
// keeps the surface stable. Each query restricts to `DATABASE()` so the runner's
// connection-bound database is the implicit filter.
const SQL_TABLES = `SELECT
  table_name AS table_name,
  table_type AS table_type,
  table_comment AS table_comment
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_name`;

const SQL_COLUMNS = `SELECT
  table_name AS table_name,
  column_name AS column_name,
  ordinal_position AS ordinal_position,
  column_default AS column_default,
  is_nullable AS is_nullable,
  data_type AS data_type,
  column_type AS column_type,
  column_key AS column_key,
  extra AS extra,
  column_comment AS column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE()
ORDER BY table_name, ordinal_position`;

const SQL_CONSTRAINTS = `SELECT
  tc.constraint_name AS constraint_name,
  tc.table_name AS table_name,
  kcu.column_name AS column_name,
  kcu.ordinal_position AS ordinal_position,
  tc.constraint_type AS constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = DATABASE()
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`;

const SQL_FOREIGN_KEYS = `SELECT
  kcu.constraint_name AS constraint_name,
  kcu.table_name AS table_name,
  kcu.column_name AS column_name,
  kcu.referenced_table_name AS referenced_table_name,
  kcu.referenced_column_name AS referenced_column_name,
  kcu.ordinal_position AS ordinal_position,
  rc.update_rule AS update_rule,
  rc.delete_rule AS delete_rule
FROM information_schema.key_column_usage kcu
JOIN information_schema.referential_constraints rc
  ON rc.constraint_schema = kcu.constraint_schema
 AND rc.constraint_name = kcu.constraint_name
WHERE kcu.table_schema = DATABASE()
  AND kcu.referenced_table_name IS NOT NULL
ORDER BY kcu.table_name, kcu.constraint_name, kcu.ordinal_position`;

const SQL_INDEXES = `SELECT
  table_name AS table_name,
  index_name AS index_name,
  column_name AS column_name,
  seq_in_index AS seq_in_index,
  non_unique AS non_unique,
  index_type AS index_type
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND index_name <> 'PRIMARY'
ORDER BY table_name, index_name, seq_in_index`;

const SQL_VIEWS = `SELECT
  table_name AS table_name,
  view_definition AS view_definition
FROM information_schema.views
WHERE table_schema = DATABASE()
ORDER BY table_name`;

/** Internal: the catalog SQL strings, exposed for snapshot-based tests. */
export const MYSQL_CATALOG_SQL = {
  tables: SQL_TABLES,
  columns: SQL_COLUMNS,
  constraints: SQL_CONSTRAINTS,
  foreign_keys: SQL_FOREIGN_KEYS,
  indexes: SQL_INDEXES,
  views: SQL_VIEWS,
} as const;

type TableRow = {
  table_name: string;
  table_type: "BASE TABLE" | "VIEW" | string;
  table_comment: string | null;
};
type ColumnRow = {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default: string | null;
  is_nullable: "YES" | "NO" | string;
  data_type: string;
  column_type: string;
  column_key: "PRI" | "UNI" | "MUL" | "" | string;
  extra: string | null;
  column_comment: string | null;
};
type ConstraintRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  constraint_type: "PRIMARY KEY" | "UNIQUE" | string;
};
type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  referenced_table_name: string;
  referenced_column_name: string;
  ordinal_position: number;
  update_rule: string | null;
  delete_rule: string | null;
};
type IndexRow = {
  table_name: string;
  index_name: string;
  column_name: string | null;
  seq_in_index: number;
  non_unique: number; // 0 = unique, 1 = non-unique
  index_type: string;
};
type ViewRow = {
  table_name: string;
  view_definition: string | null;
};

export async function describeMysql(input: DescribeMysqlInput): Promise<IntrospectionResult> {
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

  const [tableRows, columnRows, constraintRows, fkRows, indexRows, viewRows] = await Promise.all([
    run<TableRow>(SQL_TABLES),
    run<ColumnRow>(SQL_COLUMNS),
    run<ConstraintRow>(SQL_CONSTRAINTS),
    run<ForeignKeyRow>(SQL_FOREIGN_KEYS),
    run<IndexRow>(SQL_INDEXES),
    run<ViewRow>(SQL_VIEWS),
  ]);

  return foldMysqlResult({
    schemaId: input.schemaId ?? "introspected",
    tableFilter,
    tableRows,
    columnRows,
    constraintRows,
    fkRows,
    indexRows,
    viewRows,
    declaredFilters: input.filters?.tables ?? [],
  });
}

type FoldInput = {
  schemaId: string;
  tableFilter: ReturnType<typeof compileTableFilters>;
  tableRows: TableRow[];
  columnRows: ColumnRow[];
  constraintRows: ConstraintRow[];
  fkRows: ForeignKeyRow[];
  indexRows: IndexRow[];
  viewRows: ViewRow[];
  declaredFilters: ReadonlyArray<string>;
};

export function foldMysqlResult(input: FoldInput): IntrospectionResult {
  const warnings: IntrospectionWarning[] = [];

  const columnsByTable = groupBy(input.columnRows, (r) => r.table_name);
  const constraintsByTable = groupBy(input.constraintRows, (r) => r.table_name);
  const fksByTable = groupBy(input.fkRows, (r) => r.table_name);
  const indexesByTable = groupBy(input.indexRows, (r) => r.table_name);
  const viewDefByName = new Map<string, string>();
  for (const v of input.viewRows) {
    if (v.view_definition) viewDefByName.set(v.table_name, v.view_definition);
  }

  const tables: SqlTable[] = [];
  const views: SqlView[] = [];
  const viewDefinitions: Record<string, string> = {};

  for (const t of input.tableRows) {
    const qualified = `${NAMESPACE}.${t.table_name}`;
    if (!input.tableFilter(qualified)) continue;

    const cols = (columnsByTable.get(t.table_name) ?? [])
      .slice()
      .sort((a, b) => a.ordinal_position - b.ordinal_position);

    const constraints = constraintsByTable.get(t.table_name) ?? [];
    const pkRows = constraints
      .filter((c) => c.constraint_type === "PRIMARY KEY")
      .sort((a, b) => a.ordinal_position - b.ordinal_position);
    const pkColumns = pkRows.map((r) => r.column_name);
    const pkSet = new Set(pkColumns);

    const columns: SqlColumn[] = cols.map((c) => buildColumn(t.table_name, c, pkSet));

    if (t.table_type === "VIEW") {
      const def = viewDefByName.get(t.table_name) ?? "";
      const view: SqlView = {
        schema: NAMESPACE,
        name: t.table_name,
        definition: def,
        columns,
      };
      views.push(view);
      viewDefinitions[makeTableId(NAMESPACE, t.table_name)] = def;
      continue;
    }

    tables.push({
      id: makeTableId(NAMESPACE, t.table_name),
      schema: NAMESPACE,
      name: t.table_name,
      comment: t.table_comment ?? undefined,
      columns,
      primaryKey: pkColumns.length > 0 ? { columns: pkColumns } : undefined,
      foreignKeys: buildForeignKeys(fksByTable.get(t.table_name) ?? []),
      uniqueConstraints: buildUniques(constraints),
      indexes: buildIndexes(indexesByTable.get(t.table_name) ?? []),
      checkConstraints: [],
    });
  }

  // Sort for deterministic output.
  tables.sort(byName);
  views.sort(byName);

  const namespace: SqlNamespace = {
    name: NAMESPACE,
    tables,
    views,
    enums: [],
    sequences: [],
  };

  const isEmpty = tables.length === 0 && views.length === 0;
  for (const pattern of input.declaredFilters) {
    const matched =
      tables.some((t) => compileTableFilters([pattern])(`${NAMESPACE}.${t.name}`)) ||
      views.some((v) => compileTableFilters([pattern])(`${NAMESPACE}.${v.name}`));
    if (!matched) warnings.push({ code: "ambiguous_filter", filter: pattern });
  }

  const schema: SqlSchema = {
    schemaId: input.schemaId,
    schemas: isEmpty ? [] : [namespace],
  };
  return { schema, warnings, isEmpty, viewDefinitions, provider: "mysql" };
}

function buildColumn(table: string, c: ColumnRow, pkSet: Set<string>): SqlColumn {
  // `column_type` carries width/unsigned/enum-values info (e.g. `enum('a','b')`,
  // `int(10) unsigned`); `data_type` is the bare type. Prefer `column_type` for
  // accuracy in the NL→SQL prompt, fall back to `data_type`.
  const dataType = c.column_type ?? c.data_type;
  return {
    id: makeColumnId(NAMESPACE, table, c.column_name),
    name: c.column_name,
    ordinalPosition: c.ordinal_position,
    dataType,
    udtName: c.data_type,
    nullable: c.is_nullable === "YES",
    primaryKey: pkSet.has(c.column_name) || c.column_key === "PRI",
    defaultExpression: c.column_default ?? undefined,
    comment: c.column_comment || undefined,
  };
}

function buildUniques(constraints: ConstraintRow[]): SqlUnique[] {
  const byName = new Map<string, ConstraintRow[]>();
  for (const c of constraints) {
    if (c.constraint_type !== "UNIQUE") continue;
    const list = byName.get(c.constraint_name) ?? [];
    list.push(c);
    byName.set(c.constraint_name, list);
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
        schema: NAMESPACE,
        table: sample.referenced_table_name,
        columns: ordered.map((r) => r.referenced_column_name),
      },
      onDelete: mapAction(sample.delete_rule),
      onUpdate: mapAction(sample.update_rule),
    });
  }
  return fks.sort((a, b) => a.name.localeCompare(b.name));
}

function mapAction(rule: string | null): SqlForeignKeyAction | undefined {
  if (!rule) return undefined;
  const r = rule.toLowerCase();
  if (r === "cascade") return "cascade";
  if (r === "restrict") return "restrict";
  if (r === "set null") return "set null";
  if (r === "set default") return "set default";
  if (r === "no action") return "no action";
  return undefined;
}

function buildIndexes(rows: IndexRow[]): SqlIndex[] {
  const byName = new Map<string, IndexRow[]>();
  for (const r of rows) {
    const list = byName.get(r.index_name) ?? [];
    list.push(r);
    byName.set(r.index_name, list);
  }
  return Array.from(byName, ([name, list]) => {
    const ordered = list.slice().sort((a, b) => a.seq_in_index - b.seq_in_index);
    const sample = ordered[0]!;
    return {
      name,
      columns: ordered.map((r) => r.column_name ?? ""),
      unique: sample.non_unique === 0,
      method: sample.index_type,
    } satisfies SqlIndex;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k) ?? [];
    list.push(row);
    out.set(k, list);
  }
  return out;
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}
