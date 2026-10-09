import type {
  CatalogQueryResult,
  CatalogQueryRunner,
  IntrospectionFilters,
  IntrospectionResult,
  IntrospectionWarning,
  SqlColumn,
  SqlEnum,
  SqlForeignKey,
  SqlForeignKeyAction,
  SqlIndex,
  SqlNamespace,
  SqlSchema,
  SqlSequence,
  SqlTable,
  SqlUnique,
  SqlView,
  SqlCheck,
} from "@askdb/introspect";
import {
  ambiguousFilterWarnings,
  buildOrderedGroups,
  byName,
  compileTableFilters,
  groupBy,
  makeColumnId,
  makeTableId,
  rowsToRecords,
  sortedUnique,
} from "@askdb/introspect/kit";
import type {
  ColumnsRow,
  CheckConstraintsRow,
  CommentsRow,
  EnumsRow,
  ForeignKeysRow,
  IndexesRow,
  PrimaryKeysRow,
  SchemasRow,
  SequencesRow,
  TablesRow,
  UniqueConstraintsRow,
  ViewsRow,
} from "./row-types.js";
import {
  PG_FK_ACTION_BY_CODE,
  POSTGRES_TEMPLATES,
  findTemplate,
} from "./templates.js";


/**
 * Coerce a `CatalogQueryResult` (positional rows) into a list of records using the
 * template's documented column list. Tolerates extra trailing columns (which
 * shouldn't happen but keeps the path tolerant). Throws if a documented
 * column is missing — that signals a runner or bundle that does not match
 * the template's contract.
 */
export function coerceRows<T>(
  result: CatalogQueryResult,
  expected: readonly string[],
): T[] {
  return rowsToRecords<T>(result, { expectedColumns: expected, source: "@askdb/postgres" });
}

export type DescribePostgresInput = {
  runner: CatalogQueryRunner;
  filters?: IntrospectionFilters;
  /** Optional `schemaId` for the resulting `SqlSchema`. Defaults to `"introspected"`. */
  schemaId?: string;
};

export async function describePostgres(
  input: DescribePostgresInput,
): Promise<IntrospectionResult> {
  const include = input.filters?.schemas ?? [];
  const exclude = input.filters?.excludeSchemas ?? [];
  const tableFilter = compileTableFilters(input.filters?.tables);

  const includeParam = include.length === 0 ? null : include;
  const excludeParam = exclude.length === 0 ? null : exclude;
  const params: ReadonlyArray<unknown> = [includeParam, excludeParam];

  const run = async <T>(name: Parameters<typeof findTemplate>[0]) => {
    const tpl = findTemplate(name);
    const result = await input.runner(tpl.sql, params);
    return coerceRows<T>(result, tpl.columns);
  };

  const schemasRows = await run<SchemasRow>("schemas");
  const tablesRows = await run<TablesRow>("tables");
  const columnsRows = await run<ColumnsRow>("columns");
  const pkRows = await run<PrimaryKeysRow>("primary_keys");
  const fkRows = await run<ForeignKeysRow>("foreign_keys");
  const uniqueRows = await run<UniqueConstraintsRow>("unique_constraints");
  const checkRows = await run<CheckConstraintsRow>("check_constraints");
  const indexRows = await run<IndexesRow>("indexes");
  const enumRows = await run<EnumsRow>("enums");
  const sequenceRows = await run<SequencesRow>("sequences");
  const viewRows = await run<ViewsRow>("views");
  const commentRows = await run<CommentsRow>("comments");

  return foldIntrospectionResult({
    schemaId: input.schemaId ?? "introspected",
    tableFilter,
    schemasRows,
    tablesRows,
    columnsRows,
    pkRows,
    fkRows,
    uniqueRows,
    checkRows,
    indexRows,
    enumRows,
    sequenceRows,
    viewRows,
    commentRows,
    declaredFilters: input.filters?.tables ?? [],
  });
}

type FoldInput = {
  schemaId: string;
  tableFilter: ReturnType<typeof compileTableFilters>;
  schemasRows: SchemasRow[];
  tablesRows: TablesRow[];
  columnsRows: ColumnsRow[];
  pkRows: PrimaryKeysRow[];
  fkRows: ForeignKeysRow[];
  uniqueRows: UniqueConstraintsRow[];
  checkRows: CheckConstraintsRow[];
  indexRows: IndexesRow[];
  enumRows: EnumsRow[];
  sequenceRows: SequencesRow[];
  viewRows: ViewsRow[];
  commentRows: CommentsRow[];
  declaredFilters: ReadonlyArray<string>;
};

export function foldIntrospectionResult(input: FoldInput): IntrospectionResult {
  const warnings: IntrospectionWarning[] = [];

  const namespaceNames = sortedUnique([
    ...input.schemasRows.map((r) => r.schema_name),
    ...input.tablesRows.map((r) => r.schema_name),
    ...input.enumRows.map((r) => r.schema_name),
    ...input.sequenceRows.map((r) => r.schema_name),
  ]);

  // Pre-index supporting tables for fast per-table assembly.
  const columnsByTable = groupBy(
    input.columnsRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const pksByTable = groupBy(
    input.pkRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const fksByTable = groupBy(
    input.fkRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const uniquesByTable = groupBy(
    input.uniqueRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const checksByTable = groupBy(
    input.checkRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const indexesByTable = groupBy(
    input.indexRows,
    (r) => `${r.schema_name}.${r.table_name}`,
  );
  const tableCommentsByQualified = new Map<string, string>();
  const columnCommentsByQualified = new Map<string, string>();
  for (const row of input.commentRows) {
    if (!row.comment) continue;
    if (row.object_type === "relation") {
      tableCommentsByQualified.set(
        `${row.schema_name}.${row.table_name}`,
        row.comment,
      );
    } else if (row.object_type === "column" && row.column_name) {
      columnCommentsByQualified.set(
        `${row.schema_name}.${row.table_name}.${row.column_name}`,
        row.comment,
      );
    }
  }

  const enumsBySchema = new Map<string, SqlEnum[]>();
  for (const r of [...input.enumRows].sort(enumRowOrder)) {
    const list = enumsBySchema.get(r.schema_name) ?? [];
    let entry = list.find((e) => e.name === r.enum_name);
    if (!entry) {
      entry = { schema: r.schema_name, name: r.enum_name, values: [] };
      list.push(entry);
    }
    entry.values.push(r.enum_value);
    enumsBySchema.set(r.schema_name, list);
  }

  const sequencesBySchema = new Map<string, SqlSequence[]>();
  for (const r of input.sequenceRows) {
    const list = sequencesBySchema.get(r.schema_name) ?? [];
    list.push({
      schema: r.schema_name,
      name: r.sequence_name,
      dataType: r.data_type,
      startValue: r.start_value,
      increment: r.increment,
      minValue: r.minimum_value ?? undefined,
      maxValue: r.maximum_value ?? undefined,
      cycle: r.cycle_option,
    });
    sequencesBySchema.set(r.schema_name, list);
  }

  const viewDefinitions: Record<string, string> = {};
  const viewsBySchema = new Map<string, SqlView[]>();
  for (const r of input.viewRows) {
    const qualified = `${r.schema_name}.${r.view_name}`;
    if (!input.tableFilter(qualified)) continue;
    const viewColumns = (columnsByTable.get(qualified) ?? []).map((cr) =>
      buildColumn(cr, /* primaryKeyNames */ new Set(), columnCommentsByQualified),
    );
    const view: SqlView = {
      schema: r.schema_name,
      name: r.view_name,
      definition: r.definition,
      columns: viewColumns,
    };
    const list = viewsBySchema.get(r.schema_name) ?? [];
    list.push(view);
    viewsBySchema.set(r.schema_name, list);
    viewDefinitions[makeTableId(r.schema_name, r.view_name)] = r.definition;
  }

  const tablesBySchema = new Map<string, SqlTable[]>();
  for (const t of input.tablesRows) {
    if (t.relkind !== "r" && t.relkind !== "p") continue;
    const qualified = `${t.schema_name}.${t.table_name}`;
    if (!input.tableFilter(qualified)) continue;

    const colRows = (columnsByTable.get(qualified) ?? []).slice().sort(
      (a, b) => a.ordinal_position - b.ordinal_position,
    );

    const pkColumnNames = (pksByTable.get(qualified) ?? [])
      .slice()
      .sort((a, b) => a.key_position - b.key_position)
      .map((r) => r.column_name);
    const pkSet = new Set(pkColumnNames);

    const columns: SqlColumn[] = colRows.map((cr) =>
      buildColumn(cr, pkSet, columnCommentsByQualified),
    );

    const foreignKeys = buildForeignKeys(fksByTable.get(qualified) ?? []);
    const uniqueConstraints = buildUniques(uniquesByTable.get(qualified) ?? []);
    const checkConstraints = buildChecks(checksByTable.get(qualified) ?? []);
    const indexes = buildIndexes(indexesByTable.get(qualified) ?? []);

    const list = tablesBySchema.get(t.schema_name) ?? [];
    list.push({
      id: makeTableId(t.schema_name, t.table_name),
      schema: t.schema_name,
      name: t.table_name,
      comment:
        tableCommentsByQualified.get(qualified) ?? t.comment ?? undefined,
      columns,
      primaryKey: pkColumnNames.length > 0 ? { columns: pkColumnNames } : undefined,
      foreignKeys,
      uniqueConstraints,
      indexes,
      checkConstraints,
      rowLevelSecurity: { enabled: t.row_level_security },
    });
    tablesBySchema.set(t.schema_name, list);
  }

  const schemas: SqlNamespace[] = namespaceNames
    .map((name) => ({
      name,
      tables: (tablesBySchema.get(name) ?? []).slice().sort(byName),
      views: (viewsBySchema.get(name) ?? []).slice().sort(byName),
      enums: (enumsBySchema.get(name) ?? []).slice().sort(byName),
      sequences: (sequencesBySchema.get(name) ?? []).slice().sort(byName),
    }))
    .filter(
      (ns) =>
        ns.tables.length > 0 ||
        ns.views.length > 0 ||
        ns.enums.length > 0 ||
        ns.sequences.length > 0,
    );

  warnings.push(
    ...ambiguousFilterWarnings(
      input.declaredFilters,
      schemas.flatMap((ns) => [...ns.tables, ...ns.views].map((t) => `${ns.name}.${t.name}`)),
    ),
  );

  const schema: SqlSchema = { schemaId: input.schemaId, schemas };
  const isEmpty =
    schemas.length === 0 ||
    schemas.every(
      (ns) =>
        ns.tables.length === 0 &&
        ns.views.length === 0 &&
        ns.enums.length === 0 &&
        ns.sequences.length === 0,
    );

  return { schema, warnings, isEmpty, viewDefinitions, provider: "postgres" };
}

function buildColumn(
  row: ColumnsRow,
  pkColumns: Set<string>,
  columnCommentsByQualified: Map<string, string>,
): SqlColumn {
  return {
    id: makeColumnId(row.schema_name, row.table_name, row.column_name),
    name: row.column_name,
    ordinalPosition: row.ordinal_position,
    dataType: row.data_type,
    udtName: row.udt_name,
    nullable: row.is_nullable,
    primaryKey: pkColumns.has(row.column_name),
    defaultExpression: row.default_expression ?? undefined,
    comment:
      columnCommentsByQualified.get(
        `${row.schema_name}.${row.table_name}.${row.column_name}`,
      ) ??
      row.comment ??
      undefined,
  };
}

function buildForeignKeys(rows: ForeignKeysRow[]): SqlForeignKey[] {
  // Group by constraint name, preserving conkey/confkey order via key_position.
  const byConstraint = new Map<
    string,
    {
      sample: ForeignKeysRow;
      ordered: ForeignKeysRow[];
    }
  >();
  for (const row of rows) {
    const entry = byConstraint.get(row.constraint_name) ?? {
      sample: row,
      ordered: [],
    };
    entry.ordered.push(row);
    byConstraint.set(row.constraint_name, entry);
  }
  const fks: SqlForeignKey[] = [];
  for (const [name, { sample, ordered }] of byConstraint) {
    ordered.sort((a, b) => a.key_position - b.key_position);
    fks.push({
      name,
      columns: ordered.map((r) => r.column_name),
      references: {
        schema: sample.referenced_schema_name,
        table: sample.referenced_table_name,
        columns: ordered.map((r) => r.referenced_column_name),
      },
      onDelete: mapFkAction(sample.on_delete_code),
      onUpdate: mapFkAction(sample.on_update_code),
    });
  }
  return fks.sort((a, b) => a.name.localeCompare(b.name));
}

function mapFkAction(code: string | null): SqlForeignKeyAction | undefined {
  if (!code) return undefined;
  const action = PG_FK_ACTION_BY_CODE[code];
  return action as SqlForeignKeyAction | undefined;
}

function buildUniques(rows: UniqueConstraintsRow[]): SqlUnique[] {
  return buildOrderedGroups(
    rows,
    (r) => r.constraint_name,
    (r) => r.key_position,
    (name, ordered) => ({ name, columns: ordered.map((r) => r.column_name) }),
  );
}

function buildChecks(rows: CheckConstraintsRow[]): SqlCheck[] {
  return rows
    .map((r) => ({
      name: r.constraint_name,
      expression: r.expression,
    }))
    .sort(byName);
}

function buildIndexes(rows: IndexesRow[]): SqlIndex[] {
  return rows
    .map((r) => {
      const cols = normalizePgTextArray(r.columns).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      );
      const idx: SqlIndex = {
        name: r.index_name,
        columns: cols,
        unique: r.is_unique,
        method: r.method,
      };
      if (r.expressions) idx.expressions = [r.expressions];
      return idx;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePgTextArray(value: unknown): Array<string | null> {
  if (Array.isArray(value)) return [...value];
  if (typeof value !== "string") return [];
  if (value === "") return [];

  // Defensive compatibility for runners that do not decode Postgres arrays.
  // The canonical SQL casts to text[], so `pg` returns arrays on the live path;
  // bundle ingestion in M5 may still surface literal strings.
  if (!value.startsWith("{") || !value.endsWith("}")) return [value];
  const inner = value.slice(1, -1);
  if (inner === "") return [];
  return inner.split(",").map((item) => {
    if (item === "NULL") return null;
    if (item.startsWith('"') && item.endsWith('"')) {
      return item.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return item;
  });
}

function enumRowOrder(a: EnumsRow, b: EnumsRow): number {
  if (a.schema_name !== b.schema_name) {
    return a.schema_name.localeCompare(b.schema_name);
  }
  if (a.enum_name !== b.enum_name) return a.enum_name.localeCompare(b.enum_name);
  return a.enum_position - b.enum_position;
}

// `POSTGRES_TEMPLATES` is unused at runtime here but referenced in tests; keep
// the import live so type-checkers see the dep without needing a side-effect
// import elsewhere.
void POSTGRES_TEMPLATES;
