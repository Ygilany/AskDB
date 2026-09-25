import type {
  CatalogQueryRunner,
  IntrospectionFilters,
  IntrospectionResult,
  IntrospectionWarning,
  SqlColumn,
  SqlForeignKey,
  SqlIndex,
  SqlNamespace,
  SqlSchema,
  SqlTable,
  SqlUnique,
  SqlView,
} from "@askdb/introspect";
import {
  ambiguousFilterWarnings,
  buildOrderedGroups,
  byName,
  compileTableFilters,
  groupBy,
  makeColumnId,
  makeTableId,
  mapFkAction,
  rowsToRecords,
} from "@askdb/introspect/kit";

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
// `pragma_index_info`) available since SQLite 3.16.
//
// Internal objects (`sqlite_sequence`, `sqlite_stat1`, `sqlite_autoindex_*`)
// all start with the literal, lowercase prefix `sqlite_`. We match it with
// `substr(name, 1, 7) <> 'sqlite_'` rather than `NOT LIKE 'sqlite_%'`: in LIKE
// the `_` is a single-char wildcard and matching is ASCII case-insensitive, so
// `NOT LIKE 'sqlite_%'` silently drops user tables such as `SqliteUsers`.
const NOT_INTERNAL = (col: string) => `substr(${col}, 1, 7) <> 'sqlite_'`;

const SQL_OBJECTS = `SELECT
  name AS name,
  type AS type,
  sql AS sql
FROM sqlite_master
WHERE type IN ('table', 'view') AND ${NOT_INTERNAL("name")}
ORDER BY name`;

const SQL_COLUMNS = `SELECT
  m.name AS table_name,
  p.cid AS cid,
  p.name AS column_name,
  p.type AS type,
  p."notnull" AS "notnull",
  p.dflt_value AS dflt_value,
  p.pk AS pk
FROM sqlite_master m, pragma_table_info(m.name) p
WHERE m.type IN ('table', 'view') AND ${NOT_INTERNAL("m.name")}
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
WHERE m.type = 'table' AND ${NOT_INTERNAL("m.name")}
ORDER BY m.name, fk.id, fk.seq`;

const SQL_INDEX_LIST = `SELECT
  m.name AS table_name,
  il.name AS index_name,
  il."unique" AS is_unique,
  il.origin AS origin
FROM sqlite_master m, pragma_index_list(m.name) il
WHERE m.type = 'table' AND ${NOT_INTERNAL("m.name")}
ORDER BY m.name, il.seq`;

const SQL_INDEX_INFO = `SELECT
  m.name AS table_name,
  il.name AS index_name,
  ii.seqno AS seqno,
  ii.cid AS cid,
  ii.name AS column_name
FROM sqlite_master m, pragma_index_list(m.name) il, pragma_index_info(il.name) ii
WHERE m.type = 'table' AND ${NOT_INTERNAL("m.name")}
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
  // 'c' = explicit CREATE INDEX, 'u' = auto-index backing a UNIQUE constraint,
  // 'pk' = auto-index backing a PRIMARY KEY (per PRAGMA index_list docs)
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

  const run = async <T>(sql: string): Promise<T[]> => rowsToRecords<T>(await runner(sql));

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
  const indexInfoByIndex = groupBy(input.indexInfoRows, (r) => `${r.table_name}::${r.index_name}`);

  const tableRefs = buildTableRefIndex(input.objectRows, columnsByTable);

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
      foreignKeys: buildForeignKeys(fksByTable.get(obj.name) ?? [], tableRefs),
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
  warnings.push(
    ...ambiguousFilterWarnings(
      input.declaredFilters,
      [...tables, ...views].map((t) => `${NAMESPACE}.${t.name}`),
    ),
  );

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

type TableRef = { name: string; pkColumns: string[] };

/**
 * Case-insensitive index of every table's canonical name and ordered PK
 * columns. SQLite identifiers are case-insensitive, so `REFERENCES Authors`
 * resolves to a table created as `authors`.
 */
function buildTableRefIndex(
  objectRows: ObjectRow[],
  columnsByTable: Map<string, ColumnRow[]>,
): Map<string, TableRef> {
  const refs = new Map<string, TableRef>();
  for (const obj of objectRows) {
    if (obj.type !== "table") continue;
    const pkColumns = (columnsByTable.get(obj.name) ?? [])
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.column_name);
    refs.set(obj.name.toLowerCase(), { name: obj.name, pkColumns });
  }
  return refs;
}

function buildForeignKeys(
  rows: ForeignKeyRow[],
  tableRefs: Map<string, TableRef>,
): SqlForeignKey[] {
  // `fk_id` is unique per table; rows with the same id form one multi-column FK.
  return buildOrderedGroups(
    rows,
    (r) => r.fk_id,
    (r) => r.seq,
    (_fkId, ordered): SqlForeignKey => {
      const sample = ordered[0]!;
      const target = tableRefs.get(sample.referenced_table.toLowerCase());
      // SQLite doesn't name foreign keys; synthesize a stable name.
      const name = `${sample.table_name}_${ordered.map((r) => r.column_name).join("_")}_fkey`;
      return {
        name,
        columns: ordered.map((r) => r.column_name),
        references: {
          schema: NAMESPACE,
          table: target?.name ?? sample.referenced_table,
          // `REFERENCES parent` without a column list targets the parent's
          // PRIMARY KEY; pragma_foreign_key_list reports `to` as NULL then.
          // Resolve it to the parent's PK column at the same position (PK
          // ordinal order). Only when the parent's PK is unknown (e.g. a
          // dangling reference) do we fall back to the child column name.
          columns: ordered.map(
            (r, i) => r.referenced_column ?? target?.pkColumns[i] ?? r.column_name,
          ),
        },
        onDelete: mapFkAction(sample.on_delete),
        onUpdate: mapFkAction(sample.on_update),
      };
    },
  );
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

  uniqueConstraints.sort(byName);
  indexes.sort(byName);
  return { uniqueConstraints, indexes };
}
