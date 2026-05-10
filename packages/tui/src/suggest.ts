import type {
  EnrichmentCandidate,
  EnrichmentContext,
  EnrichmentTarget,
  V2Table,
} from "@askdb/core";
import type { Workspace } from "./workspace.js";

export type SuggestEnrichmentForTui = (
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

export function buildSuggestionTarget(
  workspace: Workspace,
  source: SuggestSource,
): EnrichmentTarget {
  const table = findTable(workspace, source.tableId);
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

export function buildSuggestionContext(
  workspace: Workspace,
  tableId: string,
): EnrichmentContext {
  const table = findTable(workspace, tableId);
  const relatedIds = new Set<string>();
  const columnToTable = new Map<string, string>();

  for (const wt of workspace.tables) {
    for (const column of wt.physical.columns) {
      columnToTable.set(column.id, wt.physical.id);
    }
  }

  for (const rel of table.relationships ?? []) {
    const fromTable = columnToTable.get(rel.from);
    const toTable = columnToTable.get(rel.to);
    if (fromTable && fromTable !== table.id) relatedIds.add(fromTable);
    if (toTable && toTable !== table.id) relatedIds.add(toTable);
  }

  const neighbors = [...relatedIds]
    .map((id) => workspace.tables.find((wt) => wt.physical.id === id)?.physical)
    .filter((t): t is V2Table => Boolean(t))
    .slice(0, 4);

  return {
    schemaId: workspace.physical.schemaId,
    ...(neighbors.length > 0 ? { neighbors } : {}),
  };
}

function findTable(workspace: Workspace, tableId: string): V2Table {
  const table = workspace.tables.find((wt) => wt.physical.id === tableId)?.physical;
  if (!table) throw new Error(`No such table: ${tableId}`);
  return table;
}
