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
 * SQLite has a single namespace per database file. We emit it as `"public"`
 * to match `@askdb/prisma`'s convention and keep table ids cross-engine stable.
 */
const NAMESPACE = "public";

export type DescribeSqliteInput = {
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

// SQLite catalog SQL — relies on the table-valued PRAGMA functions
// (`pragma_table_info`, `pragma_foreign_key_list`, `pragma_index_list`,
// `pragma_index_info`) available since SQLite 3.16. The `sqlite_%` prefix
// covers internal objects (`sqlite_sequence`, FTS shadow tables, etc.).

const SQL_OBJECTS = `SELECT
  name AS name,
  type AS type,
  sql AS sql
FROM sqlite_master
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY name`;

const SQL_COLUMNS = `SELECT
  m.name AS table_name,
  p.cid AS cid,
  p.name AS column_name,
  p.type AS type,
  p."notnull" AS notnull,
  p.dflt_value AS dflt_value,
  p.pk AS pk
FROM sqlite_master m, pragma_table_info(m.name) p
WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid`;

const SQL_FOREIGN_KEYS = `SELECT
  m.name AS table_name,
  fk.id AS fk_id,
  fk.seq AS seq,
  fk."table" AS referenced_table,
  fk."from" AS column_name,
  fk."to" AS referenced_column,
  fk.on_update AS on_update,
  fk.on_delete AS on_delete
FROM sqlite_master m, pragma_foreign_key_list(m.name) fk
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, fk.id, fk.seq`;

const SQL_INDEX_LIST = `SELECT
  m.name AS table_name,
  il.name AS index_name,
  il."unique" AS is_unique,
  il.origin AS origin
FROM sqlite_master m, pragma_index_list(m.name) il
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, il.seq`;

const SQL_INDEX_INFO = `SELECT
  m.name AS table_name,
  il.name AS index_name,
  ii.seqno AS seqno,
  ii.cid AS cid,
  ii.name AS column_name
FROM sqlite_master m, pragma_index_list(m.name) il, pragma_index_info(il.name) ii
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, il.name, ii.seqno`;

/** Internal: the catalog SQL strings, exposed for snapshot-based tests. */
export const SQLITE_CATALOG_SQL = {
  objects: SQL_OBJECTS,
  columns: SQL_COLUMNS,
  foreign_keys: SQL_FOREIGN_KEYS,
  index_list: SQL_INDEX_LIST,
  index_info: SQL_INDEX_INFO,
} as const;

type ObjectRow = { name: string; type: "table" | "view" | string; sql: string | null };
type ColumnRow = {
  table_name: string;
  cid: number;
  column_name: string;
  type: string;
  notnull: 0 | 1 | number;
  dflt_value: string | null;
  pk: number; // 0 = not in PK; >=1 is the 1-based PK ordinal
};
type ForeignKeyRow = {
  table_name: string;
  fk_id: number;
  seq: number;
  referenced_table: string;
  column_name: string;
  referenced_column: string | null;
  on_update: string | null;
  on_delete: string | null;
};
type IndexListRow = {
  table_name: string;
  index_name: string;
  is_unique: 0 | 1 | number;
  // 'c' = auto-created (e.g. UNIQUE col), 'u' = explicit CREATE INDEX, 'pk' = PK index
  origin: "c" | "u" | "pk" | string;
};
type IndexInfoRow = {
  table_name: string;
  index_name: string;
  seqno: number;
  cid: number;
  column_name: string;
};

export async function describeSqlite(input: DescribeSqliteInput): Promise<IntrospectionResult> {
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

  const [objectRows, columnRows, fkRows, indexListRows, indexInfoRows] = await Promise.all([
    run<ObjectRow>(SQL_OBJECTS),
    run<ColumnRow>(SQL_COLUMNS),
    run<ForeignKeyRow>(SQL_FOREIGN_KEYS),
    run<IndexListRow>(SQL_INDEX_LIST),
    run<IndexInfoRow>(SQL_INDEX_INFO),
  ]);

  return foldSqliteResult({
    schemaId: input.schemaId ?? "introspected",
    tableFilter,
    objectRows,
    columnRows,
    fkRows,
    indexListRows,
    indexInfoRows,
    declaredFilters: input.filters?.tables ?? [],
  });
}

type FoldInput = {
  schemaId: string;
  tableFilter: ReturnType<typeof compileTableFilters>;
  objectRows: ObjectRow[];
  columnRows: ColumnRow[];
  fkRows: ForeignKeyRow[];
  indexListRows: IndexListRow[];
  indexInfoRows: IndexInfoRow[];
  declaredFilters: ReadonlyArray<string>;
};

export function foldSqliteResult(input: FoldInput): IntrospectionResult {
  const warnings: IntrospectionWarning[] = [];

  const columnsByTable = groupBy(input.columnRows, (r) => r.table_name);
  const fksByTable = groupBy(input.fkRows, (r) => r.table_name);
  const indexListByTable = groupBy(input.indexListRows, (r) => r.table_name);
  // index info is keyed by `(table_name, index_name)` so we group per index.
  const indexInfoByIndex = new Map<string, IndexInfoRow[]>();
  for (const r of input.indexInfoRows) {
    const key = `${r.table_name}::${r.index_name}`;
    const list = indexInfoByIndex.get(key) ?? [];
    list.push(r);
    indexInfoByIndex.set(key, list);
  }

  const tables: SqlTable[] = [];
  const views: SqlView[] = [];
  const viewDefinitions: Record<string, string> = {};

  for (const obj of input.objectRows) {
    const qualified = `${NAMESPACE}.${obj.name}`;
    if (!input.tableFilter(qualified)) continue;

    const cols = (columnsByTable.get(obj.name) ?? []).slice().sort((a, b) => a.cid - b.cid);

    // PK columns are flagged by `pk > 0`; the value is the 1-based PK ordinal,
    // so sort by it to get the composite-PK order right.
    const pkColumns = cols
      .filter((c) => c.pk > 0)
      .slice()
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.column_name);
    const pkSet = new Set(pkColumns);

    const columns: SqlColumn[] = cols.map((c) => buildColumn(obj.name, c, pkSet));

    if (obj.type === "view") {
      const def = obj.sql ?? "";
      const view: SqlView = {
        schema: NAMESPACE,
        name: obj.name,
        definition: def,
        columns,
      };
      views.push(view);
      viewDefinitions[makeTableId(NAMESPACE, obj.name)] = def;
      continue;
    }

    const indexList = indexListByTable.get(obj.name) ?? [];
    const { uniqueConstraints, indexes } = buildIndexesAndUniques(
      obj.name,
      indexList,
      indexInfoByIndex,
    );

    tables.push({
      id: makeTableId(NAMESPACE, obj.name),
      schema: NAMESPACE,
      name: obj.name,
      comment: undefined,
      columns,
      primaryKey: pkColumns.length > 0 ? { columns: pkColumns } : undefined,
      foreignKeys: buildForeignKeys(fksByTable.get(obj.name) ?? []),
      uniqueConstraints,
      indexes,
      checkConstraints: [],
    });
  }

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
  return { schema, warnings, isEmpty, viewDefinitions, provider: "sqlite" };
}

function buildColumn(table: string, c: ColumnRow, pkSet: Set<string>): SqlColumn {
  // SQLite stores the raw declared type string (may be empty for typeless cols).
  const dataType = c.type && c.type.length > 0 ? c.type : "BLOB";
  return {
    id: makeColumnId(NAMESPACE, table, c.column_name),
    name: c.column_name,
    ordinalPosition: c.cid + 1, // pragma_table_info.cid is 0-based
    dataType,
    udtName: dataType,
    nullable: c.notnull === 0,
    primaryKey: pkSet.has(c.column_name) || c.pk > 0,
    defaultExpression: c.dflt_value ?? undefined,
    comment: undefined,
  };
}

function buildForeignKeys(rows: ForeignKeyRow[]): SqlForeignKey[] {
  // `fk_id` is unique per table; rows with the same id form one multi-column FK.
  const byFk = new Map<number, ForeignKeyRow[]>();
  for (const r of rows) {
    const list = byFk.get(r.fk_id) ?? [];
    list.push(r);
    byFk.set(r.fk_id, list);
  }
  const fks: SqlForeignKey[] = [];
  for (const [, list] of byFk) {
    const ordered = list.slice().sort((a, b) => a.seq - b.seq);
    const sample = ordered[0]!;
    // SQLite doesn't name foreign keys; synthesize a stable name.
    const name = `${sample.table_name}_${ordered.map((r) => r.column_name).join("_")}_fkey`;
    fks.push({
      name,
      columns: ordered.map((r) => r.column_name),
      references: {
        schema: NAMESPACE,
        table: sample.referenced_table,
        // SQLite returns NULL `to` columns when the FK references the PK by
        // position — fall back to the source column name in that case (the
        // model is approximate either way for grounding NL→SQL).
        columns: ordered.map((r) => r.referenced_column ?? r.column_name),
      },
      onDelete: mapAction(sample.on_delete),
      onUpdate: mapAction(sample.on_update),
    });
  }
  return fks.sort((a, b) => a.name.localeCompare(b.name));
}

function buildIndexesAndUniques(
  tableName: string,
  indexList: IndexListRow[],
  indexInfoByIndex: Map<string, IndexInfoRow[]>,
): { uniqueConstraints: SqlUnique[]; indexes: SqlIndex[] } {
  const uniqueConstraints: SqlUnique[] = [];
  const indexes: SqlIndex[] = [];

  for (const il of indexList) {
    if (il.origin === "pk") continue; // PK index — captured separately via pragma_table_info.pk
    const key = `${tableName}::${il.index_name}`;
    const info = (indexInfoByIndex.get(key) ?? []).slice().sort((a, b) => a.seqno - b.seqno);
    const cols = info.map((r) => r.column_name);
    if (cols.length === 0) continue;

    if (il.is_unique === 1 && il.origin === "u") {
      // Declared UNIQUE constraint.
      uniqueConstraints.push({ name: il.index_name, columns: cols });
    }
    indexes.push({
      name: il.index_name,
      columns: cols,
      unique: il.is_unique === 1,
      method: "btree",
    });
  }

  uniqueConstraints.sort((a, b) => a.name.localeCompare(b.name));
  indexes.sort((a, b) => a.name.localeCompare(b.name));
  return { uniqueConstraints, indexes };
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
