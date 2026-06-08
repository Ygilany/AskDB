import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type { TenantPolicyFrontmatter, V2Concept } from "@askdb/core";
import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type { StudioTableDto, StudioWorkspaceDto } from "@/shared/api";
import {
  getWorkspace,
  saveConcepts,
  saveTable,
  saveTenantPolicy,
  suggest,
  suggestTenantPolicy,
} from "../api";
import { parseList } from "../lib/format";

async function handleSuggestTenantPolicy() {
  return suggestTenantPolicy();
}

type LoadState = { kind: "loading" | "ready" | "error"; message?: string };
export type StatusMessage = { kind: "neutral" | "loading" | "success" | "error"; text: string };
type SuggestionDialog = { source: SuggestSource; label: string; candidates: Array<{ text: string }> };
type SuggestionCache = Record<string, SuggestionDialog>;

interface WorkspaceContextValue {
  loadState: LoadState;
  workspace: StudioWorkspaceDto | null;
  tables: StudioTableDto[];
  filteredTables: StudioTableDto[];
  selectedTable: StudioTableDto | null;
  selectedTableId: string | null;
  setSelectedTableId: (id: string | null) => void;
  drafts: Record<string, TableDraft>;
  selectedDraft: TableDraft | null;
  dirty: boolean;
  tableSearch: string;
  setTableSearch: (q: string) => void;
  saveStatus: StatusMessage | null;
  setSaveStatus: (s: StatusMessage | null) => void;
  busy: Set<string>;
  suggestionDialog: SuggestionDialog | null;
  setSuggestionDialog: (d: SuggestionDialog | null) => void;
  suggestingKey: string | null;

  load: () => Promise<void>;
  saveSelectedTable: () => Promise<void>;
  resetSelectedDraft: () => void;
  updateTableDraft: (tableId: string, updater: (d: TableDraft) => TableDraft) => void;
  updateColumnDraft: (tableId: string, columnId: string, updater: (d: ColumnDraft) => ColumnDraft) => void;
  requestSuggestion: (source: SuggestSource, label: string) => Promise<void>;
  applySuggestion: (text: string) => void;
  handleSaveConcepts: (concepts: V2Concept[]) => Promise<void>;
  handleSaveTenantPolicy: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<boolean>;
  handleSuggestTenantPolicy: () => Promise<{ frontmatter: TenantPolicyFrontmatter; body: string }>;
  withBusy: (key: string, task: () => Promise<void>) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

type WorkspaceState = {
  loadState: LoadState;
  workspace: StudioWorkspaceDto | null;
  selectedTableId: string | null;
  drafts: Record<string, TableDraft>;
  tableSearch: string;
  saveStatus: StatusMessage | null;
  suggestionDialog: SuggestionDialog | null;
  suggestionCache: SuggestionCache;
  suggestingKey: string | null;
  busy: Set<string>;
};

type WorkspaceAction =
  | { type: "set_loadState"; payload: LoadState }
  | { type: "load_complete"; workspace: StudioWorkspaceDto }
  | { type: "set_workspace"; payload: StudioWorkspaceDto | null }
  | { type: "workspace_and_drafts"; workspace: StudioWorkspaceDto }
  | { type: "set_selectedTableId"; payload: string | null }
  | { type: "set_drafts"; payload: Record<string, TableDraft> }
  | { type: "set_tableSearch"; payload: string }
  | { type: "set_saveStatus"; payload: StatusMessage | null }
  | { type: "set_suggestionDialog"; payload: SuggestionDialog | null }
  | { type: "set_suggestingKey"; payload: string | null }
  | { type: "suggestion_loaded"; key: string; dialog: SuggestionDialog }
  | { type: "busy_add"; key: string }
  | { type: "busy_remove"; key: string }
  | { type: "reset_draft"; tableId: string; draft: TableDraft }
  | { type: "update_draft"; tableId: string; updater: (d: TableDraft) => TableDraft };

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "set_loadState": return { ...state, loadState: action.payload };
    case "load_complete": {
      const draftMap = makeDraftMap(action.workspace);
      return {
        ...state,
        workspace: action.workspace,
        drafts: draftMap,
        selectedTableId: state.selectedTableId ?? action.workspace.tables[0]?.physical.id ?? null,
        loadState: { kind: "ready" },
      };
    }
    case "set_workspace": return { ...state, workspace: action.payload };
    case "workspace_and_drafts": return {
      ...state,
      workspace: action.workspace,
      drafts: makeDraftMap(action.workspace),
    };
    case "set_selectedTableId": return { ...state, selectedTableId: action.payload };
    case "set_drafts": return { ...state, drafts: action.payload };
    case "set_tableSearch": return { ...state, tableSearch: action.payload };
    case "set_saveStatus": return { ...state, saveStatus: action.payload };
    case "set_suggestionDialog": return { ...state, suggestionDialog: action.payload };
    case "set_suggestingKey": return { ...state, suggestingKey: action.payload };
    case "suggestion_loaded": return {
      ...state,
      suggestionCache: { ...state.suggestionCache, [action.key]: action.dialog },
      suggestionDialog: action.dialog,
    };
    case "busy_add": { const s = new Set(state.busy); s.add(action.key); return { ...state, busy: s }; }
    case "busy_remove": { const s = new Set(state.busy); s.delete(action.key); return { ...state, busy: s }; }
    case "reset_draft": return {
      ...state,
      drafts: { ...state.drafts, [action.tableId]: action.draft },
      saveStatus: { kind: "neutral", text: `Reverted.` },
    };
    case "update_draft": {
      const current = clone(state.drafts[action.tableId] ?? {} as TableDraft);
      return {
        ...state,
        drafts: { ...state.drafts, [action.tableId]: action.updater(current) },
        saveStatus: { kind: "neutral", text: "Unsaved changes." },
      };
    }
  }
}

const initialWorkspaceState: WorkspaceState = {
  loadState: { kind: "loading" },
  workspace: null,
  selectedTableId: null,
  drafts: {},
  tableSearch: "",
  saveStatus: null,
  suggestionDialog: null,
  suggestionCache: {},
  suggestingKey: null,
  busy: new Set(),
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const {
    loadState, workspace, selectedTableId, drafts, tableSearch,
    saveStatus, suggestionDialog, suggestionCache, suggestingKey, busy,
  } = state;

  const setSelectedTableId = useCallback((v: string | null) => dispatch({ type: "set_selectedTableId", payload: v }), []);
  const setTableSearch = useCallback((v: string) => dispatch({ type: "set_tableSearch", payload: v }), []);
  const setSaveStatus = useCallback((v: StatusMessage | null) => dispatch({ type: "set_saveStatus", payload: v }), []);
  const setSuggestionDialog = useCallback((v: SuggestionDialog | null) => dispatch({ type: "set_suggestionDialog", payload: v }), []);

  const tables = useMemo(() => workspace?.tables ?? [], [workspace]);
  const selectedTable = useMemo(
    () => tables.find((t) => t.physical.id === selectedTableId) ?? tables[0] ?? null,
    [tables, selectedTableId],
  );
  const selectedDraft = selectedTable ? drafts[selectedTable.physical.id] ?? selectedTable.draft : null;
  const dirty =
    Boolean(selectedTable && selectedDraft) &&
    JSON.stringify(selectedDraft) !== JSON.stringify(selectedTable?.draft);

  const filteredTables = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    if (!query) return tables;
    return tables.filter((table) => {
      const draft = drafts[table.physical.id] ?? table.draft;
      return [table.physical.name, table.physical.schema, table.physical.id, ...(draft.aliases ?? []), ...(draft.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [drafts, tableSearch, tables]);

  useEffect(() => {
    if (saveStatus?.kind === "success" || saveStatus?.kind === "neutral") {
      const id = setTimeout(() => setSaveStatus(null), 4000);
      return () => clearTimeout(id);
    }
  }, [saveStatus, setSaveStatus]);

  const withBusy = useCallback(async (key: string, task: () => Promise<void>) => {
    dispatch({ type: "busy_add", key });
    try { await task(); } finally {
      dispatch({ type: "busy_remove", key });
    }
  }, []);

  const load = useCallback(async () => {
    dispatch({ type: "set_loadState", payload: { kind: "loading" } });
    try {
      const nextWorkspace = await getWorkspace();
      dispatch({ type: "load_complete", workspace: nextWorkspace });
    } catch (error) {
      dispatch({ type: "set_loadState", payload: { kind: "error", message: getErrorMessage(error) } });
    }
  }, []);

  const saveSelectedTable = useCallback(async () => {
    if (!selectedTable || !selectedDraft) return;
    setSaveStatus({ kind: "loading", text: "Saving changes..." });
    await withBusy("save", async () => {
      try {
        const nextWorkspace = await saveTable(selectedTable.physical.id, { draft: selectedDraft });
        dispatch({ type: "workspace_and_drafts", workspace: nextWorkspace });
        setSaveStatus({ kind: "success", text: `Saved ${selectedTable.physical.name}.` });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }, [selectedDraft, selectedTable, setSaveStatus, withBusy]);

  const resetSelectedDraft = useCallback(() => {
    if (!selectedTable) return;
    dispatch({ type: "reset_draft", tableId: selectedTable.physical.id, draft: clone(selectedTable.draft) });
    setSaveStatus({ kind: "neutral", text: `Reverted ${selectedTable.physical.name}.` });
  }, [selectedTable, setSaveStatus]);

  const updateTableDraft = useCallback((tableId: string, updater: (d: TableDraft) => TableDraft) => {
    dispatch({ type: "update_draft", tableId, updater });
  }, []);

  const updateColumnDraft = useCallback((tableId: string, columnId: string, updater: (d: ColumnDraft) => ColumnDraft) => {
    updateTableDraft(tableId, (draft) => {
      const columns = { ...draft.columns };
      columns[columnId] = updater({ ...(columns[columnId] ?? {}) });
      return { ...draft, columns };
    });
  }, [updateTableDraft]);

  const requestSuggestion = useCallback(async (source: SuggestSource, label: string) => {
    const key = suggestionKey(source);
    const cached = suggestionCache[key];
    if (cached) {
      setSuggestionDialog(cached);
      return;
    }

    dispatch({ type: "set_suggestingKey", payload: key });
    try {
      const result = await suggest({ source });
      const nextDialog = { source, label, candidates: result.candidates };
      dispatch({ type: "suggestion_loaded", key, dialog: nextDialog });
    } catch (error) {
      setSaveStatus({ kind: "error", text: getErrorMessage(error) });
    } finally {
      dispatch({ type: "set_suggestingKey", payload: null });
    }
  }, [setSaveStatus, setSuggestionDialog, suggestionCache]);

  const applySuggestion = useCallback((text: string) => {
    if (!suggestionDialog) return;
    const source = suggestionDialog.source;
    if (source.scope === "table") {
      updateTableDraft(source.tableId, (draft) => applyTableSuggestion(draft, source.field, text));
    } else {
      updateColumnDraft(source.tableId, source.columnId, (draft) => applyColumnSuggestion(draft, source.field, text));
    }
  }, [suggestionDialog, updateColumnDraft, updateTableDraft]);

  const handleSaveConcepts = useCallback(async (concepts: V2Concept[]) => {
    setSaveStatus({ kind: "loading", text: "Saving concepts..." });
    await withBusy("save-concepts", async () => {
      try {
        const nextWorkspace = await saveConcepts({ concepts });
        dispatch({ type: "set_workspace", payload: nextWorkspace });
        setSaveStatus({ kind: "success", text: "Concepts saved." });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }, [setSaveStatus, withBusy]);

  const handleSaveTenantPolicy = useCallback(async (frontmatter: TenantPolicyFrontmatter, body?: string) => {
    setSaveStatus({ kind: "loading", text: "Saving tenant policy..." });
    let saved = false;
    await withBusy("save-tenant-policy", async () => {
      try {
        const nextWorkspace = await saveTenantPolicy({ frontmatter, body });
        dispatch({ type: "set_workspace", payload: nextWorkspace });
        setSaveStatus({ kind: "success", text: "Tenant policy saved." });
        saved = true;
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
    return saved;
  }, [setSaveStatus, withBusy]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    loadState, workspace, tables, filteredTables, selectedTable, selectedTableId, setSelectedTableId,
    drafts, selectedDraft, dirty, tableSearch, setTableSearch, saveStatus, setSaveStatus, busy,
    suggestionDialog, setSuggestionDialog, suggestingKey,
    load, saveSelectedTable, resetSelectedDraft, updateTableDraft, updateColumnDraft,
    requestSuggestion, applySuggestion, handleSaveConcepts, handleSaveTenantPolicy, handleSuggestTenantPolicy,
    withBusy,
  }), [
    applySuggestion, busy, dirty, drafts, filteredTables, handleSaveConcepts,
    handleSaveTenantPolicy, load, loadState, requestSuggestion, resetSelectedDraft,
    saveSelectedTable, saveStatus, selectedDraft, selectedTable, selectedTableId,
    setSaveStatus, setSelectedTableId, setSuggestionDialog, setTableSearch,
    suggestingKey, suggestionDialog, tableSearch, tables, updateColumnDraft,
    updateTableDraft, withBusy, workspace,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function makeDraftMap(workspace: StudioWorkspaceDto): Record<string, TableDraft> {
  return Object.fromEntries(workspace.tables.map((t) => [t.physical.id, clone(t.draft)]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeList(existing: string[] | undefined, incoming: string[]): string[] {
  const base = existing ?? [];
  return [...base, ...incoming.filter((item) => !base.includes(item))];
}

function applyTableSuggestion(draft: TableDraft, field: string, text: string): TableDraft {
  if (field === "aliases" || field === "tags")
    return { ...draft, [field]: mergeList((draft as Record<string, string[]>)[field], parseList(text)) };
  return { ...draft, [field]: text };
}

function applyColumnSuggestion(draft: ColumnDraft, field: string, text: string): ColumnDraft {
  if (field === "aliases" || field === "enum")
    return { ...draft, [field]: mergeList((draft as Record<string, string[]>)[field], parseList(text)) };
  return { ...draft, [field]: text };
}

function suggestionKey(source: SuggestSource): string {
  if (source.scope === "table") return `table:${source.tableId}:${source.field}`;
  return `column:${source.tableId}:${source.columnId}:${source.field}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
