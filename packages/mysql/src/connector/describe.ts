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
 *
 * - **Default (no `filters.schemas`)**: the connector reads the connection's
 *   database (`DATABASE()`) and emits it under a single namespace named
 *   `"public"`, matching `@askdb/prisma`'s convention so table ids stay stable
 *   across engines.
 * - **Database list (`filters.schemas`)**: the connector reads every listed
 *   database (`table_schema IN (…)`) and each becomes its own namespace, named
 *   after the database. Foreign keys that cross databases keep the referenced
 *   database. `filters.excludeSchemas` removes entries from the list.
 *   `introspection.providerConfig.mysql.databases` and
 *   `askdb introspect --schemas` both feed this list.
 */
const DEFAULT_NAMESPACE = "public";

export type DescribeMysqlInput = {
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

// information_schema is well-documented; pinning the SQL inside the package
// keeps the surface stable. Every query is scoped by one predicate on the
// schema column: `= DATABASE()` by default, or `IN (?, …)` for a database list.
type Scope = (column: string) => string;

const connectionDatabase: Scope = (column) => `${column} = DATABASE()`;

function listedDatabases(count: number): Scope {
  const markers = Array.from({ length: count }, () => "?").join(", ");
  return (column) => `${column} IN (${markers})`;
}

function catalogSql(scope: Scope) {
  return {
    tables: `SELECT
  table_schema AS table_schema,
  table_name AS table_name,
  table_type AS table_type,
  table_comment AS table_comment
FROM information_schema.tables
WHERE ${scope("table_schema")}
  AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_schema, table_name`,

    columns: `SELECT
  table_schema AS table_schema,
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
WHERE ${scope("table_schema")}
ORDER BY table_schema, table_name, ordinal_position`,

    constraints: `SELECT
  tc.table_schema AS table_schema,
  tc.constraint_name AS constraint_name,
  tc.table_name AS table_name,
  kcu.column_name AS column_name,
  kcu.ordinal_position AS ordinal_position,
  tc.constraint_type AS constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_schema = tc.table_schema
 AND kcu.table_name = tc.table_name
WHERE ${scope("tc.table_schema")}
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,

    foreign_keys: `SELECT
  kcu.table_schema AS table_schema,
  kcu.constraint_name AS constraint_name,
  kcu.table_name AS table_name,
  kcu.column_name AS column_name,
  kcu.referenced_table_schema AS referenced_table_schema,
  kcu.referenced_table_name AS referenced_table_name,
  kcu.referenced_column_name AS referenced_column_name,
  kcu.ordinal_position AS ordinal_position,
  rc.update_rule AS update_rule,
  rc.delete_rule AS delete_rule
FROM information_schema.key_column_usage kcu
JOIN information_schema.referential_constraints rc
  ON rc.constraint_schema = kcu.constraint_schema
 AND rc.constraint_name = kcu.constraint_name
WHERE ${scope("kcu.table_schema")}
  AND kcu.referenced_table_name IS NOT NULL
ORDER BY kcu.table_schema, kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,

    indexes: `SELECT
  table_schema AS table_schema,
  table_name AS table_name,
  index_name AS index_name,
  column_name AS column_name,
  seq_in_index AS seq_in_index,
  non_unique AS non_unique,
  index_type AS index_type
FROM information_schema.statistics
WHERE ${scope("table_schema")}
  AND index_name <> 'PRIMARY'
ORDER BY table_schema, table_name, index_name, seq_in_index`,

    views: `SELECT
  table_schema AS table_schema,
  table_name AS table_name,
  view_definition AS view_definition
FROM information_schema.views
WHERE ${scope("table_schema")}
ORDER BY table_schema, table_name`,
  } as const;
}

/** Internal: the default (connection-database) catalog SQL strings, exposed for snapshot-based tests. */
export const MYSQL_CATALOG_SQL = catalogSql(connectionDatabase);

type TableRow = {
  table_schema: string;
  table_name: string;
  table_type: "BASE TABLE" | "VIEW" | string;
  table_comment: string | null;
};
type ColumnRow = {
  table_schema: string;
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
  table_schema: string;
  constraint_name: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  constraint_type: "PRIMARY KEY" | "UNIQUE" | string;
};
type ForeignKeyRow = {
  table_schema: string;
  constraint_name: string;
  table_name: string;
  column_name: string;
  referenced_table_schema: string | null;
  referenced_table_name: string;
  referenced_column_name: string;
  ordinal_position: number;
  update_rule: string | null;
  delete_rule: string | null;
};
type IndexRow = {
  table_schema: string;
  table_name: string;
  index_name: string;
  column_name: string | null;
  seq_in_index: number;
  non_unique: number; // 0 = unique, 1 = non-unique
  index_type: string;
};
type ViewRow = {
  table_schema: string;
  table_name: string;
  view_definition: string | null;
};

export async function describeMysql(input: DescribeMysqlInput): Promise<IntrospectionResult> {
  const runner = input.runner;
  const tableFilter = compileTableFilters(input.filters?.tables);
  const excluded = new Set(input.filters?.excludeSchemas ?? []);
  const databases = [...new Set(input.filters?.schemas ?? [])].filter((d) => d && !excluded.has(d));
  const listed = (input.filters?.schemas?.length ?? 0) > 0;
  const sql = listed ? catalogSql(listedDatabases(databases.length)) : MYSQL_CATALOG_SQL;
  const params = listed ? databases : undefined;

  const run = async <T>(query: string): Promise<T[]> => {
    // Every listed database was excluded: nothing to read.
    if (listed && databases.length === 0) return [];
    const result = await runner(query, params);
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
    run<TableRow>(sql.tables),
    run<ColumnRow>(sql.columns),
    run<ConstraintRow>(sql.constraints),
    run<ForeignKeyRow>(sql.foreign_keys),
    run<IndexRow>(sql.indexes),
    run<ViewRow>(sql.views),
  ]);

  return foldMysqlResult({
    schemaId: input.schemaId ?? "introspected",
    namespaceOf: listed ? (database) => database : () => DEFAULT_NAMESPACE,
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
  /**
   * Maps a row's database to the namespace it renders under: the database name
   * itself for a database list, `"public"` for the connection's database.
   */
  namespaceOf: (database: string) => string;
  tableFilter: ReturnType<typeof compileTableFilters>;
  tableRows: TableRow[];
  columnRows: ColumnRow[];
  constraintRows: ConstraintRow[];
  fkRows: ForeignKeyRow[];
  indexRows: IndexRow[];
  viewRows: ViewRow[];
  declaredFilters: ReadonlyArray<string>;
};

/** Grouping key for a table: database + name, so equal table names in two databases stay apart. */
function tableKey(row: { table_schema: string; table_name: string }): string {
  return `${row.table_schema}\u0000${row.table_name}`;
}

export function foldMysqlResult(input: FoldInput): IntrospectionResult {
  const warnings: IntrospectionWarning[] = [];

  const columnsByTable = groupBy(input.columnRows, tableKey);
  const constraintsByTable = groupBy(input.constraintRows, tableKey);
  const fksByTable = groupBy(input.fkRows, tableKey);
  const indexesByTable = groupBy(input.indexRows, tableKey);
  const viewDefByTable = new Map<string, string>();
  for (const v of input.viewRows) {
    if (v.view_definition) viewDefByTable.set(tableKey(v), v.view_definition);
  }

  const namespaces = new Map<string, SqlNamespace>();
  const namespaceFor = (name: string): SqlNamespace => {
    let ns = namespaces.get(name);
    if (!ns) {
      ns = { name, tables: [], views: [], enums: [], sequences: [] };
      namespaces.set(name, ns);
    }
    return ns;
  };
  const viewDefinitions: Record<string, string> = {};

  for (const t of input.tableRows) {
    const namespace = input.namespaceOf(t.table_schema);
    if (!input.tableFilter(`${namespace}.${t.table_name}`)) continue;
    const key = tableKey(t);

    const cols = (columnsByTable.get(key) ?? [])
      .slice()
      .sort((a, b) => a.ordinal_position - b.ordinal_position);

    const constraints = constraintsByTable.get(key) ?? [];
    const pkRows = constraints
      .filter((c) => c.constraint_type === "PRIMARY KEY")
      .sort((a, b) => a.ordinal_position - b.ordinal_position);
    const pkColumns = pkRows.map((r) => r.column_name);
    const pkSet = new Set(pkColumns);

    const columns: SqlColumn[] = cols.map((c) => buildColumn(namespace, t.table_name, c, pkSet));

    if (t.table_type === "VIEW") {
      const def = viewDefByTable.get(key) ?? "";
      namespaceFor(namespace).views.push({ schema: namespace, name: t.table_name, definition: def, columns });
      viewDefinitions[makeTableId(namespace, t.table_name)] = def;
      continue;
    }

    namespaceFor(namespace).tables.push({
      id: makeTableId(namespace, t.table_name),
      schema: namespace,
      name: t.table_name,
      comment: t.table_comment ?? undefined,
      columns,
      primaryKey: pkColumns.length > 0 ? { columns: pkColumns } : undefined,
      foreignKeys: buildForeignKeys(fksByTable.get(key) ?? [], input.namespaceOf),
      uniqueConstraints: buildUniques(constraints),
      indexes: buildIndexes(indexesByTable.get(key) ?? []),
      checkConstraints: [],
    });
  }

  // Sort for deterministic output.
  const sortedNamespaces = [...namespaces.values()].sort(byName);
  for (const ns of sortedNamespaces) {
    ns.tables.sort(byName);
    ns.views.sort(byName);
  }
  const allTables = sortedNamespaces.flatMap((ns) => ns.tables);
  const allViews = sortedNamespaces.flatMap((ns) => ns.views);

  const isEmpty = allTables.length === 0 && allViews.length === 0;
  for (const pattern of input.declaredFilters) {
    const matches = compileTableFilters([pattern]);
    const matched =
      allTables.some((t) => matches(`${t.schema}.${t.name}`)) || allViews.some((v) => matches(`${v.schema}.${v.name}`));
    if (!matched) warnings.push({ code: "ambiguous_filter", filter: pattern });
  }

  const schema: SqlSchema = {
    schemaId: input.schemaId,
    schemas: isEmpty ? [] : sortedNamespaces,
  };
  return { schema, warnings, isEmpty, viewDefinitions, provider: "mysql" };
}

function buildColumn(namespace: string, table: string, c: ColumnRow, pkSet: Set<string>): SqlColumn {
  // `column_type` carries width/unsigned/enum-values info (e.g. `enum('a','b')`,
  // `int(10) unsigned`); `data_type` is the bare type. Prefer `column_type` for
  // accuracy in the NL→SQL prompt, fall back to `data_type`.
  const dataType = c.column_type ?? c.data_type;
  return {
    id: makeColumnId(namespace, table, c.column_name),
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

function buildForeignKeys(rows: ForeignKeyRow[], namespaceOf: (database: string) => string): SqlForeignKey[] {
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
        // A cross-database FK keeps its referenced database; the default mode maps it to `public`.
        schema: namespaceOf(sample.referenced_table_schema ?? sample.table_schema),
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
