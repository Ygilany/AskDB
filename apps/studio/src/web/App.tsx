import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Globe,
  Layers,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  Sparkles,
  Menu,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { TenantSqlOutputMode, NormalizedTenantPolicy, TenantScope, TenantPolicyFrontmatter } from "@askdb/core";
import type { ChunkType } from "@askdb/rag";
import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type { V2Concept } from "@askdb/core";
import type {
  AskResponse,
  ExecuteResponse,
  PlaygroundHistoryEntry,
  RagQueryResponse,
  StudioRequestUsageDto,
  StudioRagChunkDto,
  StudioRagStatusDto,
  StudioTableDto,
  StudioWorkspaceDto,
} from "@/shared/api";
import {
  ask,
  buildRagIndex,
  deleteFromHistory,
  executeQuery,
  getHistory,
  getRagStatus,
  getWorkspace,
  queryRag,
  saveConcepts,
  saveTable,
  saveTenantPolicy,
  saveToHistory,
  suggest,
  suggestTenantPolicy,
} from "./api";
import { Badge, Button, Field, Input, ListInput, Panel, Textarea, parseList } from "./components/ui";
import { cn } from "./lib/utils";

type PanelKey = "rag" | "settings";
type MainView = "tables" | "concepts" | "tenancy" | "playground";

type SuggestionDialog = {
  source: SuggestSource;
  label: string;
  candidates: Array<{ text: string }>;
};

type LoadState = {
  kind: "loading" | "ready" | "error";
  message?: string;
};

const CHUNK_TYPES: ChunkType[] = ["table", "column", "cql", "question", "concept", "relationship", "tenant-policy"];

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<StudioWorkspaceDto | null>(null);
  const [ragStatus, setRagStatus] = useState<StudioRagStatusDto | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>("tables");
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [tableSearch, setTableSearch] = useState("");
  const [rightPanel, setRightPanel] = useState<PanelKey>("rag");
  const [saveStatus, setSaveStatus] = useState<StatusMessage | null>(null);
  const [suggestionDialog, setSuggestionDialog] = useState<SuggestionDialog | null>(null);
  const [suggestingKey, setSuggestingKey] = useState<string | null>(null);
  const [ragMessage, setRagMessage] = useState<StatusMessage | null>(null);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragK, setRagK] = useState(8);
  const [ragTypes, setRagTypes] = useState<ChunkType[]>(["table", "column", "cql", "question", "concept"]);
  const [ragResults, setRagResults] = useState<RagQueryResponse | null>(null);
  const [ragIndexUsage, setRagIndexUsage] = useState<StudioRequestUsageDto | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [askMode, setAskMode] = useState<"full" | "rag">("full");
  const [askMessage, setAskMessage] = useState<StatusMessage | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [askTenantScopeJson, setAskTenantScopeJson] = useState("");
  const [askTenantSqlMode, setAskTenantSqlMode] = useState<TenantSqlOutputMode>("sql-only");
  const [askTenantEnabled, setAskTenantEnabled] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyEntries, setHistoryEntries] = useState<PlaygroundHistoryEntry[]>([]);
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [executeMessage, setExecuteMessage] = useState<StatusMessage | null>(null);
  const [tenancyActiveSection, setTenancyActiveSection] = useState<string>("roots");
  const tenancySectionRefs = {
    roots: useRef<HTMLDivElement>(null),
    hierarchy: useRef<HTMLDivElement>(null),
    scopedTables: useRef<HTMLDivElement>(null),
    polymorphicTables: useRef<HTMLDivElement>(null),
    globalTables: useRef<HTMLDivElement>(null),
    warnings: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (saveStatus?.kind === "success" || saveStatus?.kind === "neutral") {
      const id = setTimeout(() => setSaveStatus(null), 4000);
      return () => clearTimeout(id);
    }
  }, [saveStatus]);

  useEffect(() => {
    if (ragMessage?.kind === "success" || ragMessage?.kind === "neutral") {
      const id = setTimeout(() => setRagMessage(null), 4000);
      return () => clearTimeout(id);
    }
  }, [ragMessage]);

  useEffect(() => {
    if (askMessage?.kind === "success" || askMessage?.kind === "neutral") {
      const id = setTimeout(() => setAskMessage(null), 4000);
      return () => clearTimeout(id);
    }
  }, [askMessage]);

  const ragAvailable = Boolean(ragStatus?.hasIndex);

  useEffect(() => {
    if (!ragAvailable && askMode === "rag") {
      setAskMode("full");
    }
  }, [ragAvailable, askMode]);

  const tables = workspace?.tables ?? [];
  const selectedTable = useMemo(
    () => tables.find((table) => table.physical.id === selectedTableId) ?? tables[0] ?? null,
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

  async function load() {
    setLoadState({ kind: "loading" });
    try {
      const [nextWorkspace, nextRagStatus, nextHistory] = await Promise.all([
        getWorkspace(),
        getRagStatus(),
        getHistory(),
      ]);
      setWorkspace(nextWorkspace);
      setRagStatus(nextRagStatus);
      setDrafts(makeDraftMap(nextWorkspace));
      setSelectedTableId((current) => current ?? nextWorkspace.tables[0]?.physical.id ?? null);
      setHistoryEntries(nextHistory.entries);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: getErrorMessage(error) });
    }
  }

  async function refreshHistory() {
    try {
      const h = await getHistory();
      setHistoryEntries(h.entries);
    } catch { /* silent */ }
  }

  async function refreshRagStatus() {
    try {
      setRagStatus(await getRagStatus());
    } catch (error) {
      setRagMessage({ kind: "error", text: getErrorMessage(error) });
    }
  }

  async function saveSelectedTable() {
    if (!selectedTable || !selectedDraft) return;
    setSaveStatus({ kind: "loading", text: "Saving changes..." });
    await withBusy("save", async () => {
      try {
        const nextWorkspace = await saveTable(selectedTable.physical.id, { draft: selectedDraft });
        setWorkspace(nextWorkspace);
        setDrafts(makeDraftMap(nextWorkspace));
        setSaveStatus({ kind: "success", text: `Saved ${selectedTable.physical.name}.` });
        await refreshRagStatus();
      } catch (error) {
        setSaveStatus({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  function resetSelectedDraft() {
    if (!selectedTable) return;
    setDrafts((current) => ({
      ...current,
      [selectedTable.physical.id]: clone(selectedTable.draft),
    }));
    setSaveStatus({ kind: "neutral", text: `Reverted ${selectedTable.physical.name}.` });
  }

  function updateTableDraft(tableId: string, updater: (draft: TableDraft) => TableDraft) {
    setDrafts((current) => ({
      ...current,
      [tableId]: updater(clone(current[tableId])),
    }));
    setSaveStatus({ kind: "neutral", text: "Unsaved changes." });
  }

  function updateColumnDraft(
    tableId: string,
    columnId: string,
    updater: (draft: ColumnDraft) => ColumnDraft,
  ) {
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
      updateColumnDraft(source.tableId, source.columnId, (draft) =>
        applyColumnSuggestion(draft, source.field, text),
      );
    }
    setSuggestionDialog(null);
  }

  async function handleBuildRag() {
    setRagMessage({ kind: "loading", text: "Indexing schema chunks..." });
    setRagResults(null);
    await withBusy("rag-build", async () => {
      try {
        const result = await buildRagIndex();
        setRagStatus(result.status);
        setRagIndexUsage(result.usage);
        setRagMessage({
          kind: "success",
          text: `Indexed ${result.stats.chunksIndexed ?? 0} chunks, reused ${result.stats.chunksReused ?? 0}${formatUsageInline(result.usage)}.`,
        });
      } catch (error) {
        setRagMessage({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  async function handleQueryRag() {
    if (!ragQuestion.trim()) {
      setRagMessage({ kind: "error", text: "Enter a question before querying RAG." });
      return;
    }
    setRagMessage({ kind: "loading", text: "Retrieving chunks..." });
    await withBusy("rag-query", async () => {
      try {
        const result = await queryRag({
          question: ragQuestion.trim(),
          k: ragK,
          types: ragTypes,
        });
        setRagResults(result);
        setRagMessage({ kind: "success", text: `Retrieved ${result.results.length} chunks.` });
      } catch (error) {
        setRagMessage({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  async function handleAsk() {
    if (!askQuestion.trim()) {
      setAskMessage({ kind: "error", text: "Enter a question before generating SQL." });
      return;
    }
    let tenantScope: TenantScope | undefined;
    if (askTenantEnabled && askTenantScopeJson.trim()) {
      try {
        tenantScope = JSON.parse(askTenantScopeJson.trim()) as TenantScope;
      } catch {
        setAskMessage({ kind: "error", text: "Invalid tenant scope JSON." });
        return;
      }
    }
    setAskMessage({ kind: "loading", text: "Generating SQL..." });
    setAskResult(null);
    await withBusy("ask", async () => {
      try {
        const result = await ask({
          question: askQuestion.trim(),
          mode: askMode,
          ...(tenantScope ? { tenantScope, tenantSqlMode: askTenantSqlMode } : {}),
        });
        setAskResult(result);
        setAskMessage({ kind: "success", text: "Generated SQL." });
        void saveToHistory({
          question: askQuestion.trim(),
          mode: askMode,
          sql: result.sql,
          sqlMode: askTenantSqlMode,
          tenantScope: askTenantEnabled && askTenantScopeJson.trim() ? JSON.parse(askTenantScopeJson) as Record<string, unknown> : undefined,
          tenantParams: result.tenant?.params && result.tenant.params.length > 0
            ? Object.fromEntries(result.tenant.params.map((v, i) => [String(i + 1), v]))
            : undefined,
          explain: result.explain ?? undefined,
        }).then(() => void refreshHistory());
      } catch (error) {
        setAskMessage({ kind: "error", text: getErrorMessage(error) });
      }
    });
  }

  async function withBusy(key: string, task: () => Promise<void>) {
    setBusy((current) => new Set(current).add(key));
    try {
      await task();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  if (loadState.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading AskDB Studio
        </div>
      </div>
    );
  }

  if (loadState.kind === "error" || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-xl rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Studio failed to load
          </div>
          <p className="text-sm text-muted-foreground">{loadState.message}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-shell">
      <aside className={cn("studio-sidebar", !sidebarOpen && "hidden", "lg:flex")}>
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <img className="h-9 w-auto" src="/assets/brand/logo.png" alt="AskDB" />
            <h1 className="sr-only">AskDB Studio</h1>
            <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              Studio
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-muted-foreground">{workspace.schemaDir}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
          <button
            type="button"
            className={cn("metric text-left", mainView === "tables" && "metric-active")}
            onClick={() => setMainView("tables")}
          >
            <strong>{workspace.tables.length}</strong>
            <span>Tables</span>
          </button>
          <button
            type="button"
            className={cn("metric text-left", mainView === "concepts" && "metric-active")}
            onClick={() => setMainView("concepts")}
          >
            <strong>{workspace.concepts.length}</strong>
            <span>Concepts</span>
          </button>
          <button
            type="button"
            className={cn("metric text-left", mainView === "tenancy" && "metric-active")}
            onClick={() => setMainView("tenancy")}
          >
            <strong>{workspace.tenantPolicy ? workspace.tenantPolicy.roots.length : 0}</strong>
            <span>Tenancy</span>
          </button>
          <button
            type="button"
            className={cn("metric text-left", mainView === "playground" && "metric-active")}
            onClick={() => setMainView("playground")}
          >
            <strong>{historyEntries.length}</strong>
            <span>Playground</span>
          </button>
        </div>

        {mainView === "playground" ? (
          <>
            <div className="border-b border-border px-4 py-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Playground History
              </span>
            </div>
            <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Playground history">
              {historyEntries.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  No history yet. Ask a question to get started.
                </p>
              ) : (
                historyEntries.map((entry) => (
                  <div
                    className="table-nav-item group relative"
                    key={entry.id}
                  >
                    <button
                      className="min-w-0 flex-1 text-left"
                      type="button"
                      onClick={() => {
                        setAskQuestion(entry.question);
                        setAskMode(entry.mode as "full" | "rag");
                        setAskResult({ sql: entry.sql, explain: entry.explain ?? null, warnings: [], rag: { enabled: false, chunks: [] }, tenant: null, usage: null } as AskResponse);
                        setAskTenantSqlMode(entry.sqlMode as TenantSqlOutputMode);
                        setExecuteResult(null);
                      }}
                    >
                      <span className="block truncate font-medium">{entry.question}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline">{entry.mode}</Badge>
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </button>
                    <button
                      className="ml-1 shrink-0 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                      type="button"
                      title="Delete"
                      onClick={() => {
                        void deleteFromHistory(entry.id).then(() => void refreshHistory());
                      }}
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ))
              )}
            </nav>
          </>
        ) : mainView === "tenancy" ? (
          <>
            <div className="border-b border-border px-4 py-2.5">
              <span className="text-xs font-semibold text-muted-foreground">Tenancy</span>
            </div>
            <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Tenancy sections">
              {(
                [
                  {
                    key: "roots",
                    label: "Roots",
                    icon: <Shield className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.roots.length ?? 0,
                    warning: false,
                  },
                  {
                    key: "hierarchy",
                    label: "Hierarchy",
                    icon: <ChevronRight className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.hierarchy.length ?? 0,
                    warning: false,
                  },
                  {
                    key: "scopedTables",
                    label: "Scoped Tables",
                    icon: <Lock className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.scopedTables.length ?? 0,
                    warning: false,
                  },
                  {
                    key: "polymorphicTables",
                    label: "Polymorphic Tables",
                    icon: <Layers className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.polymorphicTables.length ?? 0,
                    warning: false,
                  },
                  {
                    key: "globalTables",
                    label: "Global Tables",
                    icon: <Globe className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.globalTables.length ?? 0,
                    warning: false,
                  },
                  {
                    key: "warnings",
                    label: "Policy Warnings",
                    icon: <AlertCircle className="h-4 w-4 shrink-0" />,
                    count: workspace.tenantPolicy?.warnings.length ?? 0,
                    warning: true,
                  },
                ] as Array<{ key: string; label: string; icon: ReactNode; count: number; warning: boolean }>
              ).map(({ key, label, icon, count, warning }) => {
                const isActive = tenancyActiveSection === key;
                return (
                  <button
                    className={cn("table-nav-item", isActive && "table-nav-item-active")}
                    key={key}
                    type="button"
                    onClick={() => {
                      setTenancyActiveSection(key);
                      tenancySectionRefs[key as keyof typeof tenancySectionRefs].current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {icon}
                      <span className="truncate font-medium">{label}</span>
                    </span>
                    <Badge variant={warning && count > 0 ? "warning" : "secondary"}
                      className={warning && count > 0 ? "text-amber-400" : undefined}
                    >
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </nav>
          </>
        ) : (
          <>
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search tables"
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                />
              </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Tables">
              {filteredTables.map((table) => {
                const isActive = table.physical.id === selectedTable?.physical.id;
                const warningCount =
                  table.missingColumnIds.length +
                  workspace.warnings.filter(
                    (warning) => "tableId" in warning && warning.tableId === table.physical.id,
                  ).length;
                return (
                  <button
                    className={cn("table-nav-item", isActive && "table-nav-item-active")}
                    key={table.physical.id}
                    type="button"
                    onClick={() => setSelectedTableId(table.physical.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{table.physical.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {table.physical.schema} · {table.physical.columns.length} columns
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      {warningCount > 0 ? <Badge variant="warning">{warningCount}</Badge> : null}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </aside>

      <main className="studio-main">
        <div className="flex items-center border-b border-border bg-card px-3 py-2 lg:hidden">
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        {mainView === "tables" ? (
          <>
            <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">
                    {selectedTable?.physical.name ?? "No table selected"}
                  </h2>
                  {dirty ? <Badge variant="warning">Unsaved</Badge> : <Badge variant="secondary">Saved</Badge>}
                  {selectedTable?.physical.sensitive ? <Badge variant="danger">Sensitive</Badge> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedTable
                    ? `${selectedTable.physical.schema}.${selectedTable.physical.name} · ${selectedTable.physical.id}`
                    : workspace.schemaId}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button variant="outline" onClick={resetSelectedDraft} disabled={!dirty || busy.has("save")}>
                  <RotateCcw className="h-4 w-4" />
                  Revert
                </Button>
                <Button onClick={() => void saveSelectedTable()} disabled={!dirty || busy.has("save")}>
                  {busy.has("save") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </header>

            {saveStatus ? <StatusBanner status={saveStatus} /> : null}

            <div className="min-h-0 flex-1 overflow-auto">
              {selectedTable && selectedDraft ? (
                <TableEditor
                  aiConfigured={workspace.aiConfigured}
                  draft={selectedDraft}
                  onRequestSuggestion={requestSuggestion}
                  onUpdateColumn={updateColumnDraft}
                  onUpdateTable={updateTableDraft}
                  suggestingKey={suggestingKey}
                  table={selectedTable}
                />
              ) : (
                <div className="p-8 text-sm text-muted-foreground">No tables found in this schema.</div>
              )}
            </div>
          </>
        ) : mainView === "tenancy" ? (
          <TenancyMain
            tenantPolicy={workspace.tenantPolicy}
            tables={workspace.tables}
            schemaId={workspace.schemaId}
            aiConfigured={workspace.aiConfigured}
            busy={busy}
            sectionRefs={tenancySectionRefs}
            onSave={async (frontmatter, body) => {
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
            }}
            saveStatus={saveStatus}
          />
        ) : mainView === "playground" ? (
          <PlaygroundMain
            workspace={workspace}
            askQuestion={askQuestion}
            setAskQuestion={setAskQuestion}
            askMode={askMode}
            setAskMode={setAskMode}
            askMessage={askMessage}
            askResult={askResult}
            askTenantEnabled={askTenantEnabled}
            setAskTenantEnabled={setAskTenantEnabled}
            askTenantScopeJson={askTenantScopeJson}
            setAskTenantScopeJson={setAskTenantScopeJson}
            askTenantSqlMode={askTenantSqlMode}
            setAskTenantSqlMode={setAskTenantSqlMode}
            ragAvailable={ragAvailable}
            busy={busy}
            executeResult={executeResult}
            executeMessage={executeMessage}
            onAsk={handleAsk}
            onExecute={async () => {
              if (!askResult?.sql) return;
              setExecuteMessage({ kind: "loading", text: "Executing query..." });
              await withBusy("execute", async () => {
                try {
                  const params = askResult.tenant?.params
                    ? (askResult.tenant.params as unknown[])
                    : [];
                  const result = await executeQuery({ sql: askResult.sql, params });
                  setExecuteResult(result);
                  if (result.ok) {
                    setExecuteMessage({ kind: "success", text: `${result.rowCount ?? 0} rows${result.truncated ? " (truncated to 500)" : ""} · ${result.durationMs ?? 0}ms` });
                  } else {
                    setExecuteMessage({ kind: "error", text: result.error ?? "Unknown error" });
                  }
                } catch (err) {
                  setExecuteMessage({ kind: "error", text: getErrorMessage(err) });
                }
              });
            }}
          />
        ) : (
          <ConceptsMain
            busy={busy}
            concepts={workspace.concepts}
            tables={workspace.tables}
            onSave={async (concepts) => {
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
            }}
            saveStatus={saveStatus}
          />
        )}
      </main>

      <aside className="studio-inspector">
        <div className="border-b border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <InspectorTab
              active={rightPanel === "rag"}
              icon={<BrainCircuit className="h-4 w-4" />}
              label="RAG"
              onClick={() => setRightPanel("rag")}
            />
            <InspectorTab
              active={rightPanel === "settings"}
              icon={<Settings className="h-4 w-4" />}
              label="Status"
              onClick={() => setRightPanel("settings")}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rightPanel === "rag" ? (
            <RagPanel
              busy={busy}
              message={ragMessage}
              onBuild={handleBuildRag}
              onQuestionChange={setRagQuestion}
              onQuery={handleQueryRag}
              onRefresh={() => void refreshRagStatus()}
              onTypesChange={setRagTypes}
              question={ragQuestion}
              ragK={ragK}
              indexUsage={ragIndexUsage}
              results={ragResults}
              selectedTypes={ragTypes}
              setRagK={setRagK}
              status={ragStatus}
            />
          ) : null}
          {rightPanel === "settings" ? (
            <SettingsPanel workspace={workspace} ragStatus={ragStatus} />
          ) : null}
        </div>
      </aside>

      {suggestionDialog ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="suggestion-title">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h3 id="suggestion-title" className="truncate text-sm font-semibold">
                  Suggestions for {suggestionDialog.label}
                </h3>
                <p className="text-xs text-muted-foreground">Select a candidate to apply it to the draft.</p>
              </div>
              <Button variant="ghost" onClick={() => setSuggestionDialog(null)}>
                Close
              </Button>
            </div>
            <div className="grid gap-3 overflow-auto p-4">
              {suggestionDialog.candidates.length > 0 ? (
                suggestionDialog.candidates.map((candidate, index) => (
                  <button
                    className="candidate"
                    key={`${candidate.text}-${index}`}
                    type="button"
                    onClick={() => applySuggestion(candidate.text)}
                  >
                    {candidate.text}
                  </button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No suggestions returned.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TableEditor({
  aiConfigured,
  draft,
  onRequestSuggestion,
  onUpdateColumn,
  onUpdateTable,
  suggestingKey,
  table,
}: {
  aiConfigured: boolean;
  draft: TableDraft;
  onRequestSuggestion: (source: SuggestSource, label: string) => Promise<void>;
  onUpdateColumn: (
    tableId: string,
    columnId: string,
    updater: (draft: ColumnDraft) => ColumnDraft,
  ) => void;
  onUpdateTable: (tableId: string, updater: (draft: TableDraft) => TableDraft) => void;
  suggestingKey: string | null;
  table: StudioTableDto;
}) {
  const tableId = table.physical.id;
  return (
    <>
      <Panel title="Table Enrichment">
        <div className="grid gap-4">
          <FieldWithSuggest
            aiConfigured={aiConfigured}
            label="Description"
            onSuggest={() =>
              onRequestSuggestion({ scope: "table", tableId, field: "description" }, "table description")
            }
            suggesting={suggestingKey === `table:${tableId}:description`}
          >
            <Textarea
              value={draft.description}
              onChange={(event) =>
                onUpdateTable(tableId, (current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </FieldWithSuggest>

          <div className="grid gap-4 lg:grid-cols-2">
            <FieldWithSuggest
              aiConfigured={aiConfigured}
              label="Aliases"
              onSuggest={() =>
                onRequestSuggestion({ scope: "table", tableId, field: "aliases" }, "table aliases")
              }
              suggesting={suggestingKey === `table:${tableId}:aliases`}
            >
              <ListInput
                value={draft.aliases}
                onChange={(value) => onUpdateTable(tableId, (current) => ({ ...current, aliases: value }))}
              />
            </FieldWithSuggest>
            <FieldWithSuggest
              aiConfigured={aiConfigured}
              label="Primary entity"
              onSuggest={() =>
                onRequestSuggestion(
                  { scope: "table", tableId, field: "primaryEntity" },
                  "primary entity",
                )
              }
              suggesting={suggestingKey === `table:${tableId}:primaryEntity`}
            >
              <Input
                value={draft.primaryEntity ?? ""}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    primaryEntity: emptyToUndefined(event.target.value),
                  }))
                }
              />
            </FieldWithSuggest>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <Field label="Tags" description="Comma-separated labels used for browsing and filtering.">
              <ListInput
                value={draft.tags}
                onChange={(value) => onUpdateTable(tableId, (current) => ({ ...current, tags: value }))}
              />
            </Field>
            <SensitiveSelect
              label="Table sensitivity override"
              value={draft.sensitive}
              onChange={(value) =>
                onUpdateTable(tableId, (current) => ({
                  ...current,
                  sensitive: value,
                }))
              }
            />
          </div>
        </div>
      </Panel>

      <Panel title="Common Query Language">
        <FieldWithSuggest
          aiConfigured={aiConfigured}
          label="Business vocabulary"
          onSuggest={() =>
            onRequestSuggestion(
              { scope: "table", tableId, field: "commonQueryLanguage" },
              "common query language",
            )
          }
          suggesting={suggestingKey === `table:${tableId}:commonQueryLanguage`}
        >
          <Textarea
            className="min-h-36"
            value={draft.commonQueryLanguage ?? ""}
            onChange={(event) =>
              onUpdateTable(tableId, (current) => ({
                ...current,
                commonQueryLanguage: event.target.value,
              }))
            }
          />
        </FieldWithSuggest>
      </Panel>

      <Panel title="Example Questions">
        <Field label="Questions">
          <Textarea
            className="min-h-32"
            value={draft.exampleQuestions ?? ""}
            onChange={(event) =>
              onUpdateTable(tableId, (current) => ({
                ...current,
                exampleQuestions: event.target.value,
              }))
            }
          />
        </Field>
      </Panel>

      <Panel
        title="Columns"
        action={
          <Badge variant={table.missingColumnIds.length > 0 ? "warning" : "secondary"}>
            {table.missingColumnIds.length} missing
          </Badge>
        }
      >
        <div className="grid gap-3">
          {table.physical.columns.map((column) => {
            const columnDraft = draft.columns[column.id] ?? {};
            return (
              <section className="column-row" key={column.id}>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold">{column.name}</h4>
                      <Badge variant="outline">{column.type}</Badge>
                      {column.primaryKey ? <Badge variant="secondary">PK</Badge> : null}
                      {column.nullable ? <Badge variant="outline">nullable</Badge> : null}
                      {column.sensitive || columnDraft.sensitive ? (
                        <Badge variant="danger">sensitive</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{column.id}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  <FieldWithSuggest
                    aiConfigured={aiConfigured}
                    label="Description"
                    onSuggest={() =>
                      onRequestSuggestion(
                        { scope: "column", tableId, columnId: column.id, field: "description" },
                        `${column.name} description`,
                      )
                    }
                    suggesting={suggestingKey === `column:${tableId}:${column.id}:description`}
                  >
                    <Textarea
                      value={columnDraft.description ?? ""}
                      onChange={(event) =>
                        onUpdateColumn(tableId, column.id, (current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </FieldWithSuggest>
                  <div className="grid gap-3 lg:grid-cols-3">
                    <FieldWithSuggest
                      aiConfigured={aiConfigured}
                      label="Aliases"
                      onSuggest={() =>
                        onRequestSuggestion(
                          { scope: "column", tableId, columnId: column.id, field: "aliases" },
                          `${column.name} aliases`,
                        )
                      }
                      suggesting={suggestingKey === `column:${tableId}:${column.id}:aliases`}
                    >
                      <ListInput
                        value={columnDraft.aliases}
                        onChange={(value) =>
                          onUpdateColumn(tableId, column.id, (current) => ({ ...current, aliases: value }))
                        }
                      />
                    </FieldWithSuggest>
                    <Field label="Enum notes">
                      <ListInput
                        value={columnDraft.enum}
                        onChange={(value) =>
                          onUpdateColumn(tableId, column.id, (current) => ({ ...current, enum: value }))
                        }
                      />
                    </Field>
                    <SensitiveSelect
                      label="Sensitivity override"
                      value={columnDraft.sensitive}
                      onChange={(value) =>
                        onUpdateColumn(tableId, column.id, (current) => ({
                          ...current,
                          sensitive: value,
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel title="Relationships">
        {table.physical.relationships && table.physical.relationships.length > 0 ? (
          <div className="grid gap-2">
            {table.physical.relationships.map((relationship, index) => (
              <div className="relationship-row" key={`${relationship.from}-${relationship.to}-${index}`}>
                <span className="break-all">{relationship.from}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="break-all">{relationship.to}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No relationships recorded for this table.</p>
        )}
      </Panel>
    </>
  );
}

function ConceptsMain({
  busy,
  concepts,
  tables,
  onSave,
  saveStatus,
}: {
  busy: Set<string>;
  concepts: V2Concept[];
  tables: StudioTableDto[];
  onSave: (concepts: V2Concept[]) => Promise<void>;
  saveStatus: StatusMessage | null;
}) {
  const [draft, setDraft] = useState<V2Concept[]>(() => clone(concepts));
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<Partial<V2Concept>>({});

  useEffect(() => {
    setDraft(clone(concepts));
  }, [concepts]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(concepts);

  function updateConcept(index: number, updater: (c: V2Concept) => V2Concept) {
    setDraft((current) => current.map((c, i) => (i === index ? updater(clone(c)) : c)));
  }

  function removeConcept(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  function commitAdd() {
    if (!addDraft.id?.trim() || !addDraft.label?.trim()) return;
    const concept: V2Concept = {
      id: addDraft.id.trim(),
      label: addDraft.label.trim(),
      ...(addDraft.synonyms?.length ? { synonyms: addDraft.synonyms } : {}),
      ...(addDraft.links?.length ? { links: addDraft.links } : {}),
      ...(addDraft.description?.trim() ? { description: addDraft.description.trim() } : {}),
    };
    setDraft((current) => [...current, concept]);
    setAddDraft({});
    setAddOpen(false);
  }

  const tableIds = tables.map((t) => t.physical.id);

  return (
    <>
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">Concepts</h2>
            {dirty ? <Badge variant="warning">Unsaved</Badge> : <Badge variant="secondary">Saved</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            Cross-table domain vocabulary for NL→SQL grounding
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft(clone(concepts))}
            disabled={!dirty || busy.has("save-concepts")}
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </Button>
          <Button
            onClick={() => void onSave(draft)}
            disabled={!dirty || busy.has("save-concepts")}
          >
            {busy.has("save-concepts") ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </header>

      {saveStatus ? <StatusBanner status={saveStatus} /> : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <Panel title="What are concepts?">
          <p className="text-sm text-muted-foreground">
            Concepts map business vocabulary to your physical schema so the AI can translate natural language into correct SQL.
            Each concept has a canonical label, synonyms users might say, links to the tables or columns that back it, and an optional description of how it is computed.
          </p>
          <div className="mt-3 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <p className="font-semibold">Example</p>
            <dl className="mt-1 grid gap-1">
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="font-medium">id</dt>
                <dd>concept:revenue</dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="font-medium">label</dt>
                <dd>Revenue</dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="font-medium">synonyms</dt>
                <dd>sales, gross sales, top line</dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="font-medium">links</dt>
                <dd>table:public.orders#total_amount</dd>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <dt className="font-medium">description</dt>
                <dd>Sum of orders.total_amount where status = &apos;paid&apos;, expressed in cents.</dd>
              </div>
            </dl>
          </div>
        </Panel>

        <Panel
          title="Concepts"
          action={
            <Button size="sm" variant="outline" onClick={() => setAddOpen((open) => !open)}>
              {addOpen ? "Cancel" : "+ Add concept"}
            </Button>
          }
        >
          <div className="grid gap-4">
            {addOpen ? (
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <p className="mb-3 text-xs font-semibold text-muted-foreground">New concept</p>
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="ID" description='Unique identifier, e.g. "concept:revenue"'>
                      <Input
                        value={addDraft.id ?? ""}
                        placeholder="concept:revenue"
                        onChange={(e) => setAddDraft((d) => ({ ...d, id: e.target.value }))}
                      />
                    </Field>
                    <Field label="Label" description='Human-readable name, e.g. "Revenue"'>
                      <Input
                        value={addDraft.label ?? ""}
                        placeholder="Revenue"
                        onChange={(e) => setAddDraft((d) => ({ ...d, label: e.target.value }))}
                      />
                    </Field>
                  </div>
                  <Field label="Synonyms" description='Comma-separated terms users might say, e.g. "sales, gross sales, top line"'>
                    <ListInput
                      value={addDraft.synonyms}
                      onChange={(v) => setAddDraft((d) => ({ ...d, synonyms: v }))}
                    />
                  </Field>
                  <Field label="Links" description={`Comma-separated table or column IDs from this schema, e.g. "${tableIds[0] ?? "table:public.orders"}" or "${tableIds[0] ? tableIds[0] + "#amount" : "table:public.orders#total_amount"}"`}>
                    <ListInput
                      value={addDraft.links}
                      onChange={(v) => setAddDraft((d) => ({ ...d, links: v }))}
                    />
                  </Field>
                  <Field label="Description" description="How this concept is computed or what it means, e.g. &quot;Sum of orders.total_amount where status = 'paid'&quot;">
                    <Textarea
                      value={addDraft.description ?? ""}
                      placeholder="Sum of orders.total_amount where status = 'paid', expressed in cents."
                      onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button
                      onClick={commitAdd}
                      disabled={!addDraft.id?.trim() || !addDraft.label?.trim()}
                    >
                      Add concept
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {draft.length === 0 && !addOpen ? (
              <EmptyText text="No concepts defined yet. Click &quot;Add concept&quot; to create your first one." />
            ) : null}

            {draft.map((concept, index) => (
              <ConceptRow
                key={`${concept.id}-${index}`}
                concept={concept}
                tableIds={tableIds}
                onChange={(updater) => updateConcept(index, updater)}
                onRemove={() => removeConcept(index)}
              />
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

function ConceptRow({
  concept,
  tableIds,
  onChange,
  onRemove,
}: {
  concept: V2Concept;
  tableIds: string[];
  onChange: (updater: (c: V2Concept) => V2Concept) => void;
  onRemove: () => void;
}) {
  return (
    <section className="column-row">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{concept.label}</h4>
          <Badge variant="outline">{concept.id}</Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={onRemove} title="Remove concept">
          ×
        </Button>
      </div>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ID" description='Unique identifier, e.g. "concept:revenue"'>
            <Input
              value={concept.id}
              onChange={(e) => onChange((c) => ({ ...c, id: e.target.value }))}
            />
          </Field>
          <Field label="Label" description='Human-readable name shown to users'>
            <Input
              value={concept.label}
              onChange={(e) => onChange((c) => ({ ...c, label: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Synonyms" description='Comma-separated alternative terms users might say'>
          <ListInput
            value={concept.synonyms}
            onChange={(v) => onChange((c) => ({ ...c, synonyms: v.length ? v : undefined }))}
          />
        </Field>
        <Field
          label="Links"
          description={`Comma-separated table or column IDs${tableIds.length ? `, e.g. "${tableIds[0]}"` : ""}`}
        >
          <ListInput
            value={concept.links}
            onChange={(v) => onChange((c) => ({ ...c, links: v.length ? v : undefined }))}
          />
        </Field>
        <Field label="Description" description="How this concept is computed or what it means">
          <Textarea
            value={concept.description ?? ""}
            onChange={(e) =>
              onChange((c) => ({ ...c, description: e.target.value || undefined }))
            }
          />
        </Field>
      </div>
    </section>
  );
}

function FieldWithSuggest({
  aiConfigured,
  children,
  label,
  onSuggest,
  suggesting,
}: {
  aiConfigured: boolean;
  children: ReactNode;
  label: string;
  onSuggest: () => Promise<void>;
  suggesting: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Button
          disabled={!aiConfigured || suggesting}
          size="sm"
          type="button"
          variant="ghost"
          onClick={() => void onSuggest()}
          title={aiConfigured ? "Suggest with configured AI model" : "Configure an AI key to enable suggestions"}
        >
          {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Suggest
        </Button>
      </div>
      {children}
    </div>
  );
}

function RagPanel({
  busy,
  indexUsage,
  message,
  onBuild,
  onQuestionChange,
  onQuery,
  onRefresh,
  onTypesChange,
  question,
  ragK,
  results,
  selectedTypes,
  setRagK,
  status,
}: {
  busy: Set<string>;
  indexUsage: StudioRequestUsageDto | null;
  message: StatusMessage | null;
  onBuild: () => Promise<void>;
  onQuestionChange: (question: string) => void;
  onQuery: () => Promise<void>;
  onRefresh: () => void;
  onTypesChange: (types: ChunkType[]) => void;
  question: string;
  ragK: number;
  results: RagQueryResponse | null;
  selectedTypes: ChunkType[];
  setRagK: (k: number) => void;
  status: StudioRagStatusDto | null;
}) {
  const queryDisabled = !status?.hasIndex || status.stale || busy.has("rag-query");
  return (
    <div className="grid gap-0">
      <Panel
        title="RAG Index"
        action={
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      >
        {status ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Metric value={status.chunksTotal} label="Chunks" />
              <Metric value={status.chunksIndexed} label="Indexed" />
              <Metric value={status.sensitiveExcluded} label="Sensitive out" />
              <Metric value={status.sensitiveIncluded} label="Sensitive in" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={status.hasIndex ? "secondary" : "warning"}>
                {status.hasIndex ? "Index present" : "No index"}
              </Badge>
              <Badge variant={status.stale ? "warning" : "secondary"}>
                {status.stale ? "Stale" : "Fresh"}
              </Badge>
              <Badge variant={status.embedder.configured ? "secondary" : "warning"}>
                {status.embedder.label}
              </Badge>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="break-all">Expected: {status.expectedEmbedderId}</span>
              <span className="break-all">Indexed: {status.embedder.indexedId ?? "none"}</span>
              <span>Dimensions: {status.dimensions} / expected {status.expectedDimensions}</span>
              <span>Updated: {status.updatedAt ?? "never"}</span>
            </div>
            <Button onClick={() => void onBuild()} disabled={busy.has("rag-build")}>
              {busy.has("rag-build") ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BrainCircuit className="h-4 w-4" />
              )}
              Build Index
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">RAG status is unavailable.</p>
        )}
      </Panel>

      <Panel title="Query Debugger">
        <div className="grid gap-3">
          <Field label="Question">
            <Textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Which customers placed orders last month?"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <Field label="Top K">
              <Input
                min={1}
                max={25}
                type="number"
                value={ragK}
                onChange={(event) => setRagK(Number(event.target.value))}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Chunk types</span>
              <div className="flex flex-wrap gap-2">
                {CHUNK_TYPES.map((type) => (
                  <label className="chunk-toggle" key={type}>
                    <input
                      checked={selectedTypes.includes(type)}
                      type="checkbox"
                      onChange={(event) => {
                        if (event.target.checked) onTypesChange([...selectedTypes, type]);
                        else onTypesChange(selectedTypes.filter((candidate) => candidate !== type));
                      }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Button disabled={queryDisabled} onClick={() => void onQuery()}>
            {busy.has("rag-query") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Query RAG
          </Button>
          {message ? <InlineStatus status={message} /> : null}
          <UsageSummary title="Last Index Usage" usage={indexUsage} />
          <UsageSummary title="Last Query Usage" usage={results?.usage ?? null} />
        </div>
      </Panel>

      <ChunkList chunks={results?.results ?? []} emptyText="No chunks retrieved yet." />
    </div>
  );
}

function PlaygroundMain({
  workspace,
  askQuestion,
  setAskQuestion,
  askMode,
  setAskMode,
  askMessage,
  askResult,
  askTenantEnabled,
  setAskTenantEnabled,
  askTenantScopeJson,
  setAskTenantScopeJson,
  askTenantSqlMode,
  setAskTenantSqlMode,
  ragAvailable,
  busy,
  executeResult,
  executeMessage,
  onAsk,
  onExecute,
}: {
  workspace: StudioWorkspaceDto;
  askQuestion: string;
  setAskQuestion: (q: string) => void;
  askMode: "full" | "rag";
  setAskMode: (m: "full" | "rag") => void;
  askMessage: StatusMessage | null;
  askResult: AskResponse | null;
  askTenantEnabled: boolean;
  setAskTenantEnabled: (v: boolean) => void;
  askTenantScopeJson: string;
  setAskTenantScopeJson: (v: string) => void;
  askTenantSqlMode: TenantSqlOutputMode;
  setAskTenantSqlMode: (v: TenantSqlOutputMode) => void;
  ragAvailable: boolean;
  busy: Set<string>;
  executeResult: ExecuteResponse | null;
  executeMessage: StatusMessage | null;
  onAsk: () => Promise<void>;
  onExecute: () => Promise<void>;
}) {
  const hasTenantPolicy = Boolean(workspace.tenantPolicy);
  return (
    <>
      <header className="flex min-h-16 items-center gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Query Playground</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Generate SQL from natural language and execute it against your database
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid h-full gap-0 lg:grid-cols-[2fr_3fr]">
          <div className="border-r border-border">
            <Panel title="Question">
              <div className="grid gap-3">
                <Field label="Natural language question">
                  <Textarea
                    value={askQuestion}
                    onChange={(event) => setAskQuestion(event.target.value)}
                    placeholder="How many users placed orders last month?"
                    rows={4}
                  />
                </Field>

                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Retrieval mode</span>
                  <div
                    className={cn("segmented", !ragAvailable && "segmented-with-disabled")}
                    role="group"
                    aria-label="Retrieval mode"
                  >
                    <button
                      className={cn(askMode === "full" && "active")}
                      type="button"
                      onClick={() => setAskMode("full")}
                    >
                      Full schema
                    </button>
                    <button
                      className={cn(askMode === "rag" && "active")}
                      disabled={!ragAvailable}
                      title={!ragAvailable ? "Build the RAG index first to query with retrieval." : undefined}
                      type="button"
                      onClick={() => setAskMode("rag")}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {!ragAvailable ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        RAG
                      </span>
                    </button>
                  </div>
                </div>

                {hasTenantPolicy ? (
                  <div className="grid gap-1.5">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={askTenantEnabled}
                        onChange={(event) => setAskTenantEnabled(event.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="text-xs font-semibold text-muted-foreground">
                        <Shield className="mr-1 inline h-3.5 w-3.5" />
                        Tenant scope
                      </span>
                    </label>
                    {askTenantEnabled ? (
                      <div className="grid gap-2">
                        <Field label="Scope JSON">
                          <Textarea
                            className="font-mono text-xs"
                            value={askTenantScopeJson}
                            onChange={(event) => setAskTenantScopeJson(event.target.value)}
                            placeholder={'{\n  "access": {\n    "kind": "ids",\n    "tenantRoot": "orgs",\n    "ids": ["org-1"]\n  }\n}'}
                            rows={5}
                          />
                        </Field>
                        <div className="grid gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">SQL output mode</span>
                          <div className="segmented" role="group" aria-label="SQL output mode">
                            <button
                              className={cn(askTenantSqlMode === "sql-only" && "active")}
                              type="button"
                              onClick={() => setAskTenantSqlMode("sql-only")}
                            >
                              Inline literals
                            </button>
                            <button
                              className={cn(askTenantSqlMode === "sql-params" && "active")}
                              type="button"
                              onClick={() => setAskTenantSqlMode("sql-params")}
                            >
                              $N parameters
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <Button disabled={busy.has("ask")} onClick={() => void onAsk()}>
                  {busy.has("ask") ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate SQL
                </Button>
                {askMessage ? <InlineStatus status={askMessage} /> : null}
              </div>
            </Panel>
          </div>

          <div className="min-h-0">
            {!askResult ? (
              <div className="flex h-full items-center justify-center p-8">
                <EmptyText text="Ask a question to generate SQL" />
              </div>
            ) : (
              <div className="grid gap-0">
                <Panel
                  title="Generated SQL"
                  action={askResult.sql ? <CopyButton value={askResult.sql} /> : undefined}
                >
                  {askResult.sql ? (
                    <pre className="sql-block">{askResult.sql}</pre>
                  ) : (
                    <EmptyText text="No SQL generated." />
                  )}
                </Panel>

                {askResult.explain !== null && askResult.explain !== undefined ? (
                  <Panel title="Explain">
                    <pre className="plain-block">{formatUnknown(askResult.explain)}</pre>
                  </Panel>
                ) : null}

                {askResult.tenant?.enabled ? (
                  <Panel title="Tenant Params">
                    {askResult.tenant.params.length > 0 ? (
                      <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                        <span className="font-semibold">Positional params:</span>{" "}
                        <code>{JSON.stringify(askResult.tenant.params)}</code>
                      </div>
                    ) : (
                      <EmptyText text="No tenant params." />
                    )}
                  </Panel>
                ) : null}

                <div className="border-t border-border px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Button
                      disabled={busy.has("execute") || !askResult.sql}
                      onClick={() => void onExecute()}
                    >
                      {busy.has("execute") ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Execute Query
                    </Button>
                    {executeMessage ? <InlineStatus status={executeMessage} /> : null}
                  </div>
                </div>

                {executeResult?.ok === true ? (
                  <Panel
                    title="Results"
                    action={
                      executeResult.truncated ? (
                        <Badge variant="warning">Showing first 500 rows</Badge>
                      ) : undefined
                    }
                  >
                    {executeResult.columns && executeResult.rows ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/30">
                              {executeResult.columns.map((col) => (
                                <th
                                  className="px-3 py-2 text-left font-semibold"
                                  key={col}
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {executeResult.rows.map((row, rowIndex) => (
                              <tr
                                className="border-b border-border last:border-b-0"
                                key={rowIndex}
                              >
                                {(row as unknown[]).map((cell, cellIndex) => (
                                  <td
                                    className="px-3 py-1.5 font-mono text-xs"
                                    key={cellIndex}
                                  >
                                    {cell === null || cell === undefined
                                      ? <span className="text-muted-foreground">NULL</span>
                                      : String(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyText text="No results." />
                    )}
                  </Panel>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TenancyMain({
  tenantPolicy,
  tables,
  schemaId,
  aiConfigured,
  busy,
  sectionRefs,
  onSave,
  saveStatus,
}: {
  tenantPolicy: NormalizedTenantPolicy | null;
  tables: StudioTableDto[];
  schemaId: string;
  aiConfigured: boolean;
  busy: Set<string>;
  sectionRefs: {
    roots: RefObject<HTMLDivElement | null>;
    hierarchy: RefObject<HTMLDivElement | null>;
    scopedTables: RefObject<HTMLDivElement | null>;
    polymorphicTables: RefObject<HTMLDivElement | null>;
    globalTables: RefObject<HTMLDivElement | null>;
    warnings: RefObject<HTMLDivElement | null>;
  };
  onSave: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<void>;
  saveStatus: StatusMessage | null;
}) {
  if (!tenantPolicy) {
    return (
      <TenancyCreateForm
        tables={tables}
        schemaId={schemaId}
        aiConfigured={aiConfigured}
        busy={busy}
        onSave={onSave}
        saveStatus={saveStatus}
      />
    );
  }

  const coverageByClassification = tenantPolicy.coverage.reduce(
    (acc, entry) => {
      acc[entry.classification] = (acc[entry.classification] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const totalTables = tenantPolicy.coverage.length;
  const coveredTables = totalTables - (coverageByClassification["unknown"] ?? 0);
  const coveragePct = totalTables > 0 ? Math.round((coveredTables / totalTables) * 100) : 0;

  return (
    <>
      <header className="flex min-h-16 items-center gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Shield className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Multi-Tenancy</h2>
            <Badge variant={tenantPolicy.enforcement === "strict" ? "danger" : "warning"}>
              {tenantPolicy.enforcement}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Schema: {tenantPolicy.schemaId} · {coveragePct}% table coverage ({coveredTables}/{totalTables})
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid gap-5">
          {/* Coverage overview */}
          <CollapsibleSection title="Coverage">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CoverageStat label="Root" count={coverageByClassification["root"] ?? 0} variant="primary" />
              <CoverageStat label="Scoped" count={coverageByClassification["scoped"] ?? 0} variant="primary" />
              <CoverageStat label="Global" count={coverageByClassification["global"] ?? 0} variant="secondary" />
              <CoverageStat label="Unknown" count={coverageByClassification["unknown"] ?? 0} variant="warning" />
            </div>
          </CollapsibleSection>

          {/* Tenant roots */}
          <div ref={sectionRefs.roots}>
            <CollapsibleSection title="Tenant Roots" count={tenantPolicy.roots.length}>
              <div className="grid gap-2">
                {tenantPolicy.roots.map((root) => (
                  <div className="rounded-md border border-border bg-card p-3" key={root.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-sm font-semibold">{root.id}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{root.label}</span>
                      </div>
                      <Badge variant="outline">col: {root.tenantIdColumn}</Badge>
                    </div>
                    {root.parent ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Parent: <code>{root.parent.root}</code> via <code>{root.parent.foreignKey}</code>
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          </div>

          {/* Hierarchy */}
          <div ref={sectionRefs.hierarchy}>
            {tenantPolicy.hierarchy.length > 0 ? (
              <CollapsibleSection title="Hierarchy Edges" count={tenantPolicy.hierarchy.length}>
                <div className="grid gap-2">
                  {tenantPolicy.hierarchy.map((edge, index) => (
                    <div className="rounded-md border border-border bg-card p-3 text-sm" key={index}>
                      <div>
                        <code>{edge.parent}</code>
                        <span className="mx-2 text-muted-foreground">&rarr;</span>
                        <code>{edge.child}</code>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">FK: {edge.foreignKey}</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>

          {/* Scoped tables */}
          <div ref={sectionRefs.scopedTables}>
            {tenantPolicy.scopedTables.length > 0 ? (
              <CollapsibleSection title="Scoped Tables" count={tenantPolicy.scopedTables.length} defaultOpen={false}>
                <div className="grid gap-2">
                  {tenantPolicy.scopedTables.map((scoped) => (
                    <div className="rounded-md border border-border bg-card p-3" key={scoped.id}>
                      <span className="font-mono text-sm font-semibold">{scoped.id}</span>
                      <div className="mt-1 grid gap-1">
                        {scoped.scopeThrough.map((scope, index) => (
                          <p className="text-xs text-muted-foreground" key={index}>
                            via <Badge variant="outline">{scope.root}</Badge>{" "}
                            {"column" in scope
                              ? <span>column <code>{scope.column}</code></span>
                              : <span>join {scope.join.map((j) => `${j.from} -> ${j.to}`).join(", ")}</span>}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>

          {/* Polymorphic tables */}
          <div ref={sectionRefs.polymorphicTables}>
            {tenantPolicy.polymorphicTables.length > 0 ? (
              <CollapsibleSection title="Polymorphic Tables" count={tenantPolicy.polymorphicTables.length} defaultOpen={false}>
                <div className="grid gap-2">
                  {tenantPolicy.polymorphicTables.map((poly) => (
                    <div className="rounded-md border border-border bg-card p-3" key={poly.id}>
                      <span className="font-mono text-sm font-semibold">{poly.id}</span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Type: <code>{poly.typeColumn}</code> · ID: <code>{poly.idColumn}</code>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(poly.mapping).map(([typeValue, targetTable]) => (
                          <Badge variant="outline" key={typeValue}>
                            {typeValue} &rarr; {targetTable}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>

          {/* Global tables */}
          <div ref={sectionRefs.globalTables}>
            {tenantPolicy.globalTables.length > 0 ? (
              <CollapsibleSection title="Global Tables" count={tenantPolicy.globalTables.length} defaultOpen={false}>
                <div className="flex flex-wrap gap-2">
                  {tenantPolicy.globalTables.map((tableId) => (
                    <Badge variant="secondary" key={tableId}>
                      {tableId}
                    </Badge>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>

          {/* Full table coverage list */}
          <CollapsibleSection title="Table Coverage" count={tenantPolicy.coverage.length} defaultOpen={false}>
            <div className="rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left font-semibold">Table</th>
                    <th className="px-3 py-2 text-left font-semibold">Classification</th>
                    <th className="px-3 py-2 text-left font-semibold">Scope Roots</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantPolicy.coverage.map((entry) => (
                    <tr className="border-b border-border last:border-b-0" key={entry.tableId}>
                      <td className="px-3 py-1.5 font-mono text-xs">{entry.tableId}</td>
                      <td className="px-3 py-1.5">
                        <Badge
                          variant={
                            entry.classification === "unknown"
                              ? "warning"
                              : entry.classification === "global"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {entry.classification}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {entry.scopeRoots?.join(", ") ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>

          {/* Warnings */}
          <div ref={sectionRefs.warnings}>
            {tenantPolicy.warnings.length > 0 ? (
              <CollapsibleSection title="Policy Warnings" count={tenantPolicy.warnings.length}>
                <div className="grid gap-2">
                  {tenantPolicy.warnings.map((warning, index) => (
                    <pre className="warning-block" key={index}>
                      {formatUnknown(warning)}
                    </pre>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function TenancyCreateForm({
  tables,
  schemaId,
  aiConfigured,
  busy,
  onSave,
  saveStatus,
}: {
  tables: StudioTableDto[];
  schemaId: string;
  aiConfigured: boolean;
  busy: Set<string>;
  onSave: (frontmatter: TenantPolicyFrontmatter, body?: string) => Promise<void>;
  saveStatus: StatusMessage | null;
}) {
  const [mode, setMode] = useState<"choose" | "manual" | "review">("choose");
  const [draftStatus, setDraftStatus] = useState<StatusMessage | null>(null);

  // Review-mode state (populated by AI or manual)
  const [draftFrontmatter, setDraftFrontmatter] = useState<TenantPolicyFrontmatter | null>(null);
  const [draftBody, setDraftBody] = useState("");

  // Manual-mode state
  const [enforcement, setEnforcement] = useState<"strict" | "warn">("strict");
  const [rootTableId, setRootTableId] = useState("");
  const [rootTenantIdColumn, setRootTenantIdColumn] = useState("");
  const [rootLabel, setRootLabel] = useState("");
  const [globalTableIds, setGlobalTableIds] = useState<string[]>([]);

  const selectedRootTable = tables.find((t) => t.physical.id === rootTableId);
  const rootColumns = selectedRootTable?.physical.columns ?? [];

  useEffect(() => {
    if (selectedRootTable && !rootLabel) {
      setRootLabel(selectedRootTable.physical.name);
    }
  }, [rootTableId]);

  useEffect(() => {
    setRootTenantIdColumn("");
  }, [rootTableId]);

  async function handleDraftWithAi() {
    setDraftStatus({ kind: "loading", text: "Analyzing schema and drafting tenant policy..." });
    try {
      const result = await suggestTenantPolicy();
      setDraftFrontmatter(result.frontmatter);
      setDraftBody(result.body);
      setMode("review");
      setDraftStatus({ kind: "success", text: "AI draft ready for review." });
    } catch (error) {
      setDraftStatus({ kind: "error", text: getErrorMessage(error) });
    }
  }

  function handleManualToReview() {
    const canBuild = rootTableId && rootTenantIdColumn && rootLabel.trim();
    if (!canBuild) return;
    const frontmatter: TenantPolicyFrontmatter = {
      schemaId,
      enforcement,
      roots: [
        {
          id: rootTableId,
          tenantIdColumn: rootTenantIdColumn,
          label: rootLabel.trim(),
        },
      ],
      ...(globalTableIds.length > 0 ? { globalTables: globalTableIds } : {}),
    };
    setDraftFrontmatter(frontmatter);
    setDraftBody("# Tenant Policy\n\n\n\n## Hierarchy\n\n\n\n## Scope Rules\n\n\n\n## Sensitive Interactions\n\n");
    setMode("review");
  }

  function handleConfirm() {
    if (!draftFrontmatter) return;
    void onSave(draftFrontmatter, draftBody || undefined);
  }

  const manualCanProceed = rootTableId && rootTenantIdColumn && rootLabel.trim();

  // ─── Step 1: Choose mode ───
  if (mode === "choose") {
    return (
      <>
        <header className="flex min-h-16 items-center gap-4 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Enable Multi-Tenancy</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure tenant isolation for your schema. A tenant-policy.md file will be created.
            </p>
          </div>
        </header>

        {draftStatus ? <StatusBanner status={draftStatus} /> : null}

        <div className="min-h-0 flex-1 overflow-auto">
          <Panel title="Getting Started">
            <p className="text-sm text-muted-foreground">
              Multi-tenancy ensures generated SQL is always scoped to the correct tenant.
              Choose how you want to configure it:
            </p>
          </Panel>

          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <button
              type="button"
              className="group rounded-lg border-2 border-dashed border-border p-6 text-left transition hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent"
              disabled={!aiConfigured || draftStatus?.kind === "loading"}
              onClick={() => void handleDraftWithAi()}
            >
              <div className="mb-3 flex items-center gap-2">
                {draftStatus?.kind === "loading" ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                ) : (
                  <Wand2 className="h-6 w-6 text-primary" />
                )}
                <h3 className="font-semibold">Draft with AI</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                {draftStatus?.kind === "loading"
                  ? "Analyzing your schema..."
                  : "Let AI analyze your schema and propose a complete tenant policy. You will review and edit every section before saving."}
              </p>
              {!aiConfigured ? (
                <p className="mt-2 text-xs text-destructive">
                  Configure an AI provider to use this option.
                </p>
              ) : null}
            </button>

            <button
              type="button"
              className="group rounded-lg border-2 border-dashed border-border p-6 text-left transition hover:border-primary/50 hover:bg-primary/5"
              onClick={() => setMode("manual")}
            >
              <div className="mb-3 flex items-center gap-2">
                <Settings className="h-6 w-6 text-muted-foreground" />
                <h3 className="font-semibold">Configure manually</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Pick the tenant root table and column yourself, then review before saving.
              </p>
            </button>
          </div>
        </div>
      </>
    );
  }

  // ─── Step 2a: Manual configuration ───
  if (mode === "manual") {
    return (
      <>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Manual Configuration</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure the basics, then review before saving.
            </p>
          </div>
          <Button variant="outline" onClick={() => setMode("choose")}>
            Back
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <Panel title="Tenant Root">
            <div className="grid gap-4">
              <Field label="Root table" description="The table whose rows represent tenants.">
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={rootTableId}
                  onChange={(e) => {
                    setRootTableId(e.target.value);
                    setRootLabel("");
                  }}
                >
                  <option value="">Select a table...</option>
                  {tables.map((t) => (
                    <option key={t.physical.id} value={t.physical.id}>
                      {t.physical.schema}.{t.physical.name}
                    </option>
                  ))}
                </select>
              </Field>

              {rootTableId ? (
                <Field label="Tenant ID column" description="The column that uniquely identifies a tenant (usually a primary key or unique identifier).">
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={rootTenantIdColumn}
                    onChange={(e) => setRootTenantIdColumn(e.target.value)}
                  >
                    <option value="">Select a column...</option>
                    {rootColumns.map((col) => (
                      <option key={col.id} value={col.name}>
                        {col.name} ({col.type}{col.primaryKey ? ", PK" : ""})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <Field label="Label" description='A human-readable label for this tenant root, e.g. "Organization" or "Company".'>
                <Input
                  value={rootLabel}
                  placeholder="e.g. Organization"
                  onChange={(e) => setRootLabel(e.target.value)}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Enforcement Mode">
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                Controls how unscoped tables are handled during SQL generation.
              </p>
              <div className="segmented" role="group" aria-label="Enforcement mode">
                <button
                  className={cn(enforcement === "strict" && "active")}
                  type="button"
                  onClick={() => setEnforcement("strict")}
                >
                  Strict
                </button>
                <button
                  className={cn(enforcement === "warn" && "active")}
                  type="button"
                  onClick={() => setEnforcement("warn")}
                >
                  Warn
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {enforcement === "strict"
                  ? "Strict: queries touching unknown (unscoped) tables will be rejected."
                  : "Warn: queries touching unknown tables will succeed but emit warnings."}
              </p>
            </div>
          </Panel>

          <Panel title="Global Tables (optional)">
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                Global tables are shared across all tenants and never filtered (e.g. lookup tables, reference data).
              </p>
              <div className="flex flex-wrap gap-2">
                {tables.map((t) => {
                  if (t.physical.id === rootTableId) return null;
                  const checked = globalTableIds.includes(t.physical.id);
                  return (
                    <label className="chunk-toggle" key={t.physical.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setGlobalTableIds((ids) => [...ids, t.physical.id]);
                          else setGlobalTableIds((ids) => ids.filter((id) => id !== t.physical.id));
                        }}
                      />
                      {t.physical.schema}.{t.physical.name}
                    </label>
                  );
                })}
              </div>
            </div>
          </Panel>

          <div className="border-t border-border p-5">
            <Button onClick={handleManualToReview} disabled={!manualCanProceed}>
              <ChevronRight className="h-4 w-4" />
              Review &amp; Confirm
            </Button>
          </div>
        </div>
      </>
    );
  }

  // ─── Step 3: Review draft ───
  return (
    <TenancyReviewDraft
      tables={tables}
      frontmatter={draftFrontmatter!}
      body={draftBody}
      busy={busy}
      saveStatus={saveStatus}
      onFrontmatterChange={setDraftFrontmatter}
      onBodyChange={setDraftBody}
      onConfirm={handleConfirm}
      onBack={() => setMode("choose")}
    />
  );
}

function TenancyReviewDraft({
  tables,
  frontmatter,
  body,
  busy,
  saveStatus,
  onFrontmatterChange,
  onBodyChange,
  onConfirm,
  onBack,
}: {
  tables: StudioTableDto[];
  frontmatter: TenantPolicyFrontmatter;
  body: string;
  busy: Set<string>;
  saveStatus: StatusMessage | null;
  onFrontmatterChange: (fm: TenantPolicyFrontmatter) => void;
  onBodyChange: (body: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  function updateEnforcement(enforcement: "strict" | "warn") {
    onFrontmatterChange({ ...frontmatter, enforcement });
  }

  function updateRootLabel(index: number, label: string) {
    const roots = [...frontmatter.roots];
    roots[index] = { ...roots[index], label };
    onFrontmatterChange({ ...frontmatter, roots });
  }

  function removeRoot(index: number) {
    const roots = frontmatter.roots.filter((_, i) => i !== index);
    if (roots.length === 0) return; // must have at least one
    onFrontmatterChange({ ...frontmatter, roots });
  }

  function removeHierarchyEdge(index: number) {
    const hierarchy = (frontmatter.hierarchy ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, hierarchy: hierarchy.length > 0 ? hierarchy : undefined });
  }

  function removeScopedTable(index: number) {
    const scopedTables = (frontmatter.scopedTables ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, scopedTables: scopedTables.length > 0 ? scopedTables : undefined });
  }

  function removePolymorphicTable(index: number) {
    const polymorphicTables = (frontmatter.polymorphicTables ?? []).filter((_, i) => i !== index);
    onFrontmatterChange({ ...frontmatter, polymorphicTables: polymorphicTables.length > 0 ? polymorphicTables : undefined });
  }

  function toggleGlobalTable(tableId: string) {
    const current = frontmatter.globalTables ?? [];
    const next = current.includes(tableId)
      ? current.filter((id) => id !== tableId)
      : [...current, tableId];
    onFrontmatterChange({ ...frontmatter, globalTables: next.length > 0 ? next : undefined });
  }

  const rootIds = new Set(frontmatter.roots.map((r) => r.id));
  const scopedIds = new Set((frontmatter.scopedTables ?? []).map((s) => s.id));
  const polyIds = new Set((frontmatter.polymorphicTables ?? []).map((p) => p.id));
  const globalIds = new Set(frontmatter.globalTables ?? []);

  return (
    <>
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Shield className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Review Tenant Policy</h2>
            <Badge variant="warning">Draft</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Review each section below. Edit or remove items before confirming.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={onBack}>
            <RotateCcw className="h-4 w-4" />
            Start Over
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy.has("save-tenant-policy") || frontmatter.roots.length === 0}
          >
            {busy.has("save-tenant-policy") ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Confirm &amp; Save
          </Button>
        </div>
      </header>

      {saveStatus ? <StatusBanner status={saveStatus} /> : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Enforcement */}
        <Panel title="Enforcement Mode">
          <div className="grid gap-2">
            <div className="segmented" role="group" aria-label="Enforcement mode">
              <button
                className={cn(frontmatter.enforcement === "strict" && "active")}
                type="button"
                onClick={() => updateEnforcement("strict")}
              >
                Strict
              </button>
              <button
                className={cn(frontmatter.enforcement === "warn" && "active")}
                type="button"
                onClick={() => updateEnforcement("warn")}
              >
                Warn
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {frontmatter.enforcement === "strict"
                ? "Queries touching unknown (unscoped) tables will be rejected."
                : "Queries touching unknown tables will succeed but emit warnings."}
            </p>
          </div>
        </Panel>

        {/* Roots */}
        <Panel title={`Tenant Roots (${frontmatter.roots.length})`} collapsible>
          <div className="grid gap-3">
            {frontmatter.roots.map((root, index) => (
              <div className="rounded-md border border-border bg-card p-3" key={root.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold">{root.id}</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant="outline">col: {root.tenantIdColumn}</Badge>
                      {root.parent ? (
                        <Badge variant="outline">
                          parent: {root.parent.root} via {root.parent.foreignKey}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {frontmatter.roots.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => removeRoot(index)} title="Remove root">
                      ×
                    </Button>
                  ) : null}
                </div>
                <div className="mt-2">
                  <Field label="Label" description="Human-readable name for this tenant root.">
                    <Input
                      value={root.label}
                      onChange={(e) => updateRootLabel(index, e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Hierarchy */}
        {(frontmatter.hierarchy ?? []).length > 0 ? (
          <Panel title={`Hierarchy Edges (${frontmatter.hierarchy!.length})`} collapsible>
            <div className="grid gap-2">
              {frontmatter.hierarchy!.map((edge, index) => (
                <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm" key={index}>
                  <div>
                    <div>
                      <code>{edge.parent}</code>
                      <span className="mx-2 text-muted-foreground">&rarr;</span>
                      <code>{edge.child}</code>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">FK: {edge.foreignKey}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeHierarchyEdge(index)} title="Remove edge">
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {/* Scoped Tables */}
        {(frontmatter.scopedTables ?? []).length > 0 ? (
          <Panel title={`Scoped Tables (${frontmatter.scopedTables!.length})`} collapsible defaultOpen={false}>
            <div className="grid gap-2">
              {frontmatter.scopedTables!.map((scoped, index) => (
                <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3" key={scoped.id}>
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold">{scoped.id}</span>
                    <div className="mt-1 grid gap-1">
                      {scoped.scopeThrough.map((scope, si) => (
                        <p className="text-xs text-muted-foreground" key={si}>
                          via <Badge variant="outline">{scope.root}</Badge>{" "}
                          {"column" in scope
                            ? <span>column <code>{scope.column}</code></span>
                            : <span>join {scope.join.map((j) => `${j.from} -> ${j.to}`).join(", ")}</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeScopedTable(index)} title="Remove">
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {/* Polymorphic Tables */}
        {(frontmatter.polymorphicTables ?? []).length > 0 ? (
          <Panel title={`Polymorphic Tables (${frontmatter.polymorphicTables!.length})`} collapsible defaultOpen={false}>
            <div className="grid gap-2">
              {frontmatter.polymorphicTables!.map((poly, index) => (
                <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-card p-3" key={poly.id}>
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold">{poly.id}</span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Type: <code>{poly.typeColumn}</code> · ID: <code>{poly.idColumn}</code>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(poly.mapping).map(([typeValue, targetTable]) => (
                        <Badge variant="outline" key={typeValue}>
                          {typeValue} &rarr; {targetTable}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removePolymorphicTable(index)} title="Remove">
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}

        {/* Global Tables */}
        <Panel title="Global Tables" collapsible defaultOpen={false}>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Global tables are shared across all tenants and never filtered.
            </p>
            <div className="flex flex-wrap gap-2">
              {tables.map((t) => {
                if (rootIds.has(t.physical.id) || scopedIds.has(t.physical.id) || polyIds.has(t.physical.id)) return null;
                const checked = globalIds.has(t.physical.id);
                return (
                  <label className="chunk-toggle" key={t.physical.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGlobalTable(t.physical.id)}
                    />
                    {t.physical.schema}.{t.physical.name}
                  </label>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* Body / documentation */}
        <Panel title="Documentation (body)" collapsible>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Optional markdown body explaining the tenant policy. Included in the tenant-policy.md file.
            </p>
            <Textarea
              className="min-h-48 font-mono text-xs"
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
            />
          </div>
        </Panel>

        {/* Raw frontmatter preview */}
        <Panel title="Frontmatter Preview" collapsible defaultOpen={false}>
          <pre className="plain-block text-xs">{JSON.stringify(frontmatter, null, 2)}</pre>
        </Panel>
      </div>
    </>
  );
}

function CollapsibleSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        className="mb-2 flex w-full items-center gap-1.5 text-sm font-semibold hover:text-primary transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        {title}{count != null ? ` (${count})` : ""}
      </button>
      {open ? children : null}
    </section>
  );
}

function CoverageStat({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: "primary" | "secondary" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-center",
        variant === "primary" && "border-primary/20 bg-primary/5",
        variant === "secondary" && "border-border bg-muted/30",
        variant === "warning" && "border-yellow-500/20 bg-yellow-500/5",
      )}
    >
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
function SettingsPanel({
  ragStatus,
  workspace,
}: {
  ragStatus: StudioRagStatusDto | null;
  workspace: StudioWorkspaceDto;
}) {
  return (
    <div className="grid gap-0">
      <Panel title="Workspace">
        <dl className="definition-list">
          <dt>Schema ID</dt>
          <dd>{workspace.schemaId}</dd>
          <dt>Schema path</dt>
          <dd>{workspace.schemaDir}</dd>
          <dt>AI provider</dt>
          <dd>{workspace.aiProvider}</dd>
          <dt>Model</dt>
          <dd>{workspace.model}</dd>
          <dt>AI suggestions</dt>
          <dd>{workspace.aiConfigured ? "Configured" : "Not configured"}</dd>
        </dl>
      </Panel>
      <Panel title="RAG Store">
        {ragStatus ? (
          <dl className="definition-list">
            <dt>Store</dt>
            <dd>{ragStatus.store.kind}</dd>
            <dt>Lock file</dt>
            <dd>{ragStatus.files.lock ? "present" : "missing"}</dd>
            {ragStatus.store.kind === "file" ? (
              <>
                <dt>Base path</dt>
                <dd>{ragStatus.store.basePath ?? "n/a"}</dd>
                <dt>Embeddings JSON</dt>
                <dd>{ragStatus.files.embeddingsJson ? "present" : "missing"}</dd>
                <dt>Embeddings binary</dt>
                <dd>{ragStatus.files.embeddingsBin ? "present" : "missing"}</dd>
              </>
            ) : null}
            {ragStatus.store.kind === "pgvector" ? (
              <>
                <dt>Table</dt>
                <dd>{ragStatus.store.table ?? "askdb_rag_chunks"}</dd>
                <dt>Index strategy</dt>
                <dd>{ragStatus.store.indexStrategy ?? "default"}</dd>
              </>
            ) : null}
            {ragStatus.store.kind === "memory" ? (
              <>
                <dt>Persistence</dt>
                <dd>In-process only</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <EmptyText text="RAG status is unavailable." />
        )}
      </Panel>
      <Panel title="Schema Warnings">
        {workspace.warnings.length > 0 ? (
          <div className="grid gap-2">
            {workspace.warnings.map((warning, index) => (
              <pre className="warning-block" key={index}>
                {formatUnknown(warning)}
              </pre>
            ))}
          </div>
        ) : (
          <EmptyText text="No schema warnings." />
        )}
      </Panel>
    </div>
  );
}

function ChunkList({
  chunks,
  emptyText,
}: {
  chunks: StudioRagChunkDto[];
  emptyText: string;
}) {
  return (
    <Panel title="Retrieved Chunks">
      {chunks.length > 0 ? (
        <div className="grid gap-3">
          {chunks.map((chunk) => (
            <article className="chunk-card" key={chunk.id}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="break-all text-sm font-semibold">{chunk.id}</h4>
                    <Badge variant="outline">{chunk.type}</Badge>
                    {chunk.sensitive ? <Badge variant="danger">sensitive</Badge> : null}
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    refs: {chunk.refs.length > 0 ? chunk.refs.join(", ") : "none"}
                  </p>
                </div>
                <Badge variant="secondary">{chunk.score.toFixed(3)}</Badge>
              </div>
              <pre className="chunk-text">{chunk.text}</pre>
            </article>
          ))}
        </div>
      ) : (
        <EmptyText text={emptyText} />
      )}
    </Panel>
  );
}

function UsageSummary({
  title,
  usage,
}: {
  title: string;
  usage: StudioRequestUsageDto | null;
}) {
  if (!usage) return null;
  const promptTokens = usage.promptTokens ?? usage.embeddingTokens;
  return (
    <section className="usage-summary" aria-label={title}>
      <h3>{title}</h3>
      <dl className="usage-grid">
        <UsageMetric label={usage.embeddingTokens === null ? "Prompt" : "Embeddings"} value={promptTokens} />
        <UsageMetric label="Completion" value={usage.completionTokens} />
        <UsageMetric className="usage-total" label="Total" value={usage.totalTokens} />
      </dl>
    </section>
  );
}

function UsageMetric({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: number | null;
}) {
  if (value === null) return null;
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{formatNumber(value)}</dd>
    </div>
  );
}

function SensitiveSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: boolean | undefined) => void;
  value: boolean | undefined;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value === undefined ? "inherit" : value ? "true" : "false"}
        onChange={(event) => {
          if (event.target.value === "inherit") onChange(undefined);
          else onChange(event.target.value === "true");
        }}
      >
        <option value="inherit">Inherit physical metadata</option>
        <option value="true">Sensitive</option>
        <option value="false">Not sensitive</option>
      </select>
    </label>
  );
}

function InspectorTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={cn("inspector-tab", active && "active")} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

type StatusMessage = {
  kind: "neutral" | "loading" | "success" | "error";
  text: string;
};

function StatusBanner({ status }: { status: StatusMessage }) {
  return (
    <div className={cn("status-banner", status.kind)}>
      {status.kind === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {status.kind === "success" ? <Check className="h-4 w-4" /> : null}
      {status.kind === "error" ? <AlertCircle className="h-4 w-4" /> : null}
      <span>{status.text}</span>
    </div>
  );
}

function InlineStatus({ status }: { status: StatusMessage }) {
  return <div className={cn("inline-status", status.kind)}>{status.text}</div>;
}

function EmptyText({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function makeDraftMap(workspace: StudioWorkspaceDto): Record<string, TableDraft> {
  return Object.fromEntries(workspace.tables.map((table) => [table.physical.id, clone(table.draft)]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formatUsageInline(usage: StudioRequestUsageDto | null): string {
  const tokens = usage?.totalTokens ?? usage?.embeddingTokens ?? null;
  return tokens === null ? "" : `, ${formatNumber(tokens)} tokens`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
