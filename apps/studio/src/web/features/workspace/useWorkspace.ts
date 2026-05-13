import { useCallback, useMemo, useState } from "react";
import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type { StudioWorkspaceDto } from "@/shared/api";
import { getWorkspace, saveTable, suggest } from "../../api";
import type { SuggestionDialogState } from "../../components/common/SuggestionDialog";
import type { StatusMessage } from "../../components/common/types";
import {
  applyColumnSuggestion,
  applyTableSuggestion,
  clone,
  makeDraftMap,
  suggestionKey,
} from "../../lib/drafts";
import { getErrorMessage } from "../../lib/format";

export type UseWorkspaceReturn = ReturnType<typeof useWorkspace>;

export function useWorkspace({
  onAfterSave,
}: {
  onAfterSave?: () => Promise<void> | void;
} = {}) {
  const [workspace, setWorkspace] = useState<StudioWorkspaceDto | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [tableSearch, setTableSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<StatusMessage | null>(null);
  const [suggestionDialog, setSuggestionDialog] = useState<SuggestionDialogState | null>(null);
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const tables = workspace?.tables ?? [];
  const selectedTable = useMemo(
    () => tables.find((table) => table.physical.id === selectedTableId) ?? tables[0] ?? null,
    [tables, selectedTableId],
  );
  const selectedDraft = selectedTable
    ? drafts[selectedTable.physical.id] ?? selectedTable.draft
    : null;
  const dirty =
    Boolean(selectedTable && selectedDraft) &&
    JSON.stringify(selectedDraft) !== JSON.stringify(selectedTable?.draft);

  const filteredTables = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return tables;
    return tables.filter((table) => {
      const draft = drafts[table.physical.id] ?? table.draft;
      return [
        table.physical.name,
        table.physical.schema,
        table.physical.id,
        ...(draft.aliases ?? []),
        ...(draft.tags ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [drafts, tableSearch, tables]);

  const load = useCallback(async () => {
    const next = await getWorkspace();
    setWorkspace(next);
    setDrafts(makeDraftMap(next));
    setSelectedTableId((current) => current ?? next.tables[0]?.physical.id ?? null);
  }, []);

  const updateTableDraft = useCallback(
    (tableId: string, updater: (draft: TableDraft) => TableDraft) => {
      setDrafts((current) => ({
        ...current,
        [tableId]: updater(clone(current[tableId])),
      }));
      setSaveStatus({ kind: "neutral", text: "Unsaved changes." });
    },
    [],
  );

  const updateColumnDraft = useCallback(
    (
      tableId: string,
      columnId: string,
      updater: (draft: ColumnDraft) => ColumnDraft,
    ) => {
      updateTableDraft(tableId, (draft) => {
        const columns = { ...draft.columns };
        columns[columnId] = updater({ ...(columns[columnId] ?? {}) });
        return { ...draft, columns };
      });
    },
    [updateTableDraft],
  );

  const saveSelectedTable = useCallback(async () => {
    if (!selectedTable || !selectedDraft) return;
    setSaveStatus({ kind: "loading", text: "Saving changes..." });
    setIsSaving(true);
    try {
      const nextWorkspace = await saveTable(selectedTable.physical.id, { draft: selectedDraft });
      setWorkspace(nextWorkspace);
      setDrafts(makeDraftMap(nextWorkspace));
      setSaveStatus({ kind: "success", text: `Saved ${selectedTable.physical.name}.` });
      await onAfterSave?.();
    } catch (error) {
      setSaveStatus({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }, [selectedTable, selectedDraft, onAfterSave]);

  const resetSelectedDraft = useCallback(() => {
    if (!selectedTable) return;
    setDrafts((current) => ({
      ...current,
      [selectedTable.physical.id]: clone(selectedTable.draft),
    }));
    setSaveStatus({ kind: "neutral", text: `Reverted ${selectedTable.physical.name}.` });
  }, [selectedTable]);

  const requestSuggestion = useCallback(
    async (source: SuggestSource, label: string) => {
      const key = suggestionKey(source);
      setSuggestingKey(key);
      try {
        const result = await suggest({ source });
        setSuggestionDialog({ source, label, candidates: result.candidates });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      } finally {
        setSuggestingKey(null);
      }
    },
    [],
  );

  const applySuggestion = useCallback(
    (text: string) => {
      if (!suggestionDialog) return;
      const source = suggestionDialog.source;
      if (source.scope === "table") {
        updateTableDraft(source.tableId, (draft) =>
          applyTableSuggestion(draft, source.field, text),
        );
      } else {
        updateColumnDraft(source.tableId, source.columnId, (draft) =>
          applyColumnSuggestion(draft, source.field, text),
        );
      }
      setSuggestionDialog(null);
    },
    [suggestionDialog, updateTableDraft, updateColumnDraft],
  );

  const closeSuggestionDialog = useCallback(() => {
    setSuggestionDialog(null);
  }, []);

  return {
    workspace,
    tables,
    filteredTables,
    selectedTable,
    selectedDraft,
    selectedTableId,
    setSelectedTableId,
    dirty,
    tableSearch,
    setTableSearch,
    updateTableDraft,
    updateColumnDraft,
    saveSelectedTable,
    resetSelectedDraft,
    isSaving,
    saveStatus,
    suggestionDialog,
    suggestingKey,
    requestSuggestion,
    applySuggestion,
    closeSuggestionDialog,
    load,
  };
}
