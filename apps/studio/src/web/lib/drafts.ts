import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type { StudioWorkspaceDto } from "@/shared/api";
import { parseList } from "./format";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function makeDraftMap(workspace: StudioWorkspaceDto): Record<string, TableDraft> {
  return Object.fromEntries(
    workspace.tables.map((table) => [table.physical.id, clone(table.draft)]),
  );
}

export function applyTableSuggestion(
  draft: TableDraft,
  field: string,
  text: string,
): TableDraft {
  if (field === "aliases" || field === "tags") return { ...draft, [field]: parseList(text) };
  return { ...draft, [field]: text };
}

export function applyColumnSuggestion(
  draft: ColumnDraft,
  field: string,
  text: string,
): ColumnDraft {
  if (field === "aliases" || field === "enum") return { ...draft, [field]: parseList(text) };
  return { ...draft, [field]: text };
}

export function suggestionKey(source: SuggestSource): string {
  if (source.scope === "table") return `table:${source.tableId}:${source.field}`;
  return `column:${source.tableId}:${source.columnId}:${source.field}`;
}
