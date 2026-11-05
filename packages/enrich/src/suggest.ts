import type {
  EnrichmentCandidate,
  EnrichmentContext,
  EnrichmentTarget,
  NormalizedSchemaV2,
  NormalizedV2Table,
} from "@askdb/core";

export type SuggestEnrichment = (
  target: EnrichmentTarget,
  context: EnrichmentContext,
) => Promise<EnrichmentCandidate[]>;

export type TableSuggestField =
  | "description"
  | "aliases"
  | "primaryEntity"
  | "commonQueryLanguage";
export type ColumnSuggestField = "description" | "aliases";

export type SuggestSource =
  | { scope: "table"; tableId: string; field: TableSuggestField }
  | {
      scope: "column";
      tableId: string;
      columnId: string;
      field: ColumnSuggestField;
    };

/**
 * The table or column a suggestion is for. `schema` is `loadSchema()`'s result, so the target
 * carries effective sensitivity (front-matter escalations included), which the enrichment
 * prompt's sensitivity rule reads.
 */
export function buildSuggestionTarget(
  schema: NormalizedSchemaV2,
  source: SuggestSource,
): EnrichmentTarget {
  const table = findTable(schema, source.tableId);
  if (source.scope === "table") {
    switch (source.field) {
      case "description":
        return { kind: "table-description", table };
      case "aliases":
        return { kind: "table-aliases", table };
      case "primaryEntity":
        return { kind: "table-primary-entity", table };
      case "commonQueryLanguage":
        return { kind: "common-query-language", table };
    }
  }

  switch (source.field) {
    case "description":
      return { kind: "column-description", table, columnId: source.columnId };
    case "aliases":
      return { kind: "column-aliases", table, columnId: source.columnId };
  }
}

/**
 * The target table's foreign-key neighbors (at most 4) and the schema id, from `loadSchema()`'s
 * result. Untracked tables (`tracked: false`) stay out, as they do from `ask()`'s prompt.
 */
export function buildSuggestionContext(
  schema: NormalizedSchemaV2,
  tableId: string,
): EnrichmentContext {
  const table = findTable(schema, tableId);
  const relatedIds = new Set<string>();
  const columnToTable = new Map<string, string>();

  for (const other of schema.tables) {
    if (other.tracked === false) continue;
    for (const column of other.columns) {
      columnToTable.set(column.id, other.id);
    }
  }

  for (const rel of table.relationships ?? []) {
    const fromTable = columnToTable.get(rel.from);
    const toTable = columnToTable.get(rel.to);
    if (fromTable && fromTable !== table.id) relatedIds.add(fromTable);
    if (toTable && toTable !== table.id) relatedIds.add(toTable);
  }

  const neighbors = [...relatedIds]
    .map((id) => schema.tables.find((other) => other.id === id))
    .filter((t): t is NormalizedV2Table => Boolean(t))
    .slice(0, 4);

  return {
    schemaId: schema.schemaId,
    ...(neighbors.length > 0 ? { neighbors } : {}),
  };
}

function findTable(schema: NormalizedSchemaV2, tableId: string): NormalizedV2Table {
  const table = schema.tables.find((t) => t.id === tableId);
  if (!table) throw new Error(`No such table: ${tableId}`);
  return table;
}
