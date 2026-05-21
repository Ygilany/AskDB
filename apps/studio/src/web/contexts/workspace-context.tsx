import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { NormalizedTenantPolicy, TenantPolicyFrontmatter, V2Concept } from "@askdb/core";
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
import { parseList } from "../components/ui";

type LoadState = { kind: "loading" | "ready" | "error"; message?: string };
export type StatusMessage = { kind: "neutral" | "loading" | "success" | "error"; text: string };
type SuggestionDialog = { source: SuggestSource; label: string; candidates: Array<{ text: string }> };

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
  handleSaveTenantPolicy: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<void>;
  handleSuggestTenantPolicy: () => Promise<{ frontmatter: TenantPolicyFrontmatter; body: string }>;
  withBusy: (key: string, task: () => Promise<void>) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<StudioWorkspaceDto | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [tableSearch, setTableSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<StatusMessage | null>(null);
  const [suggestionDialog, setSuggestionDialog] = useState<SuggestionDialog | null>(null);
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  const tables = workspace?.tables ?? [];
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
  }, [saveStatus]);

  async function withBusy(key: string, task: () => Promise<void>) {
    setBusy((c) => new Set(c).add(key));
    try { await task(); } finally {
      setBusy((c) => { const n = new Set(c); n.delete(key); return n; });
    }
  }

  const load = useCallback(async () => {
    setLoadState({ kind: "loading" });
    try {
      const nextWorkspace = await getWorkspace();
      setWorkspace(nextWorkspace);
      setDrafts(makeDraftMap(nextWorkspace));
      setSelectedTableId((c) => c ?? nextWorkspace.tables[0]?.physical.id ?? null);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: getErrorMessage(error) });
    }
  }, []);

  async function saveSelectedTable() {
    if (!selectedTable || !selectedDraft) return;
    setSaveStatus({ kind: "loading", text: "Saving changes..." });
    await withBusy("save", async () => {
      try {
        const nextWorkspace = await saveTable(selectedTable.physical.id, { draft: selectedDraft });
        setWorkspace(nextWorkspace);
        setDrafts(makeDraftMap(nextWorkspace));
        setSaveStatus({ kind: "success", text: `Saved ${selectedTable.physical.name}.` });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  function resetSelectedDraft() {
    if (!selectedTable) return;
    setDrafts((c) => ({ ...c, [selectedTable.physical.id]: clone(selectedTable.draft) }));
    setSaveStatus({ kind: "neutral", text: `Reverted ${selectedTable.physical.name}.` });
  }

  function updateTableDraft(tableId: string, updater: (d: TableDraft) => TableDraft) {
    setDrafts((c) => ({ ...c, [tableId]: updater(clone(c[tableId])) }));
    setSaveStatus({ kind: "neutral", text: "Unsaved changes." });
  }

  function updateColumnDraft(tableId: string, columnId: string, updater: (d: ColumnDraft) => ColumnDraft) {
    updateTableDraft(tableId, (draft) => {
      const columns = { ...draft.columns };
      columns[columnId] = updater({ ...(columns[columnId] ?? {}) });
      return { ...draft, columns };
    });
  }

  async function requestSuggestion(source: SuggestSource, label: string) {
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
  }

  function applySuggestion(text: string) {
    if (!suggestionDialog) return;
    const source = suggestionDialog.source;
    if (source.scope === "table") {
      updateTableDraft(source.tableId, (draft) => applyTableSuggestion(draft, source.field, text));
    } else {
      updateColumnDraft(source.tableId, source.columnId, (draft) => applyColumnSuggestion(draft, source.field, text));
    }
    setSuggestionDialog(null);
  }

  async function handleSaveConcepts(concepts: V2Concept[]) {
    setSaveStatus({ kind: "loading", text: "Saving concepts..." });
    await withBusy("save-concepts", async () => {
      try {
        const nextWorkspace = await saveConcepts({ concepts });
        setWorkspace(nextWorkspace);
        setSaveStatus({ kind: "success", text: "Concepts saved." });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  async function handleSaveTenantPolicy(frontmatter: TenantPolicyFrontmatter, body?: string) {
    setSaveStatus({ kind: "loading", text: "Saving tenant policy..." });
    await withBusy("save-tenant-policy", async () => {
      try {
        const nextWorkspace = await saveTenantPolicy({ frontmatter, body });
        setWorkspace(nextWorkspace);
        setSaveStatus({ kind: "success", text: "Tenant policy saved." });
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  async function handleSuggestTenantPolicy() {
    return suggestTenantPolicy();
  }

  const value: WorkspaceContextValue = {
    loadState, workspace, tables, filteredTables, selectedTable, selectedTableId, setSelectedTableId,
    drafts, selectedDraft, dirty, tableSearch, setTableSearch, saveStatus, setSaveStatus, busy,
    suggestionDialog, setSuggestionDialog, suggestingKey,
    load, saveSelectedTable, resetSelectedDraft, updateTableDraft, updateColumnDraft,
    requestSuggestion, applySuggestion, handleSaveConcepts, handleSaveTenantPolicy, handleSuggestTenantPolicy,
    withBusy,
  };

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
