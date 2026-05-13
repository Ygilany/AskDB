import {
  AlertCircle,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ChunkType } from "@askdb/rag";
import type { ColumnDraft, SuggestSource, TableDraft } from "@askdb/enrich";
import type {
  AskResponse,
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
  getRagStatus,
  getWorkspace,
  queryRag,
  saveTable,
  suggest,
} from "./api";
import { Badge, Button, Field, Input, Panel, Textarea } from "./components/ui";
import { cn } from "./lib/utils";

type PanelKey = "rag" | "ask" | "settings";

type SuggestionDialog = {
  source: SuggestSource;
  label: string;
  candidates: Array<{ text: string }>;
};

type LoadState = {
  kind: "loading" | "ready" | "error";
  message?: string;
};

const CHUNK_TYPES: ChunkType[] = ["table", "column", "cql", "question", "concept", "relationship"];

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<StudioWorkspaceDto | null>(null);
  const [ragStatus, setRagStatus] = useState<StudioRagStatusDto | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TableDraft>>({});
  const [tableSearch, setTableSearch] = useState("");
  const [rightPanel, setRightPanel] = useState<PanelKey>("ask");
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
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void load();
  }, []);

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
      const [nextWorkspace, nextRagStatus] = await Promise.all([getWorkspace(), getRagStatus()]);
      setWorkspace(nextWorkspace);
      setRagStatus(nextRagStatus);
      setDrafts(makeDraftMap(nextWorkspace));
      setSelectedTableId((current) => current ?? nextWorkspace.tables[0]?.physical.id ?? null);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: getErrorMessage(error) });
    }
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
    setAskMessage({ kind: "loading", text: "Generating SQL..." });
    setAskResult(null);
    await withBusy("ask", async () => {
      try {
        const result = await ask({
          question: askQuestion.trim(),
          mode: askMode,
        });
        setAskResult(result);
        setAskMessage({ kind: "success", text: "Generated SQL." });
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
      <aside className="studio-sidebar">
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

        <div className="grid grid-cols-3 gap-2 border-b border-border p-3">
          <Metric value={workspace.tables.length} label="Tables" />
          <Metric value={workspace.warnings.length} label="Warnings" />
          <Metric value={workspace.concepts.length} label="Concepts" />
        </div>

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
      </aside>

      <main className="studio-main">
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
      </main>

      <aside className="studio-inspector">
        <div className="border-b border-border p-3">
          <div className="grid grid-cols-3 gap-2">
            <InspectorTab
              active={rightPanel === "ask"}
              icon={<Bot className="h-4 w-4" />}
              label="Ask"
              onClick={() => setRightPanel("ask")}
            />
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
          {rightPanel === "ask" ? (
            <AskPanel
              busy={busy}
              message={askMessage}
              mode={askMode}
              onAsk={handleAsk}
              onGoToRag={() => setRightPanel("rag")}
              onModeChange={setAskMode}
              onQuestionChange={setAskQuestion}
              question={askQuestion}
              ragAvailable={ragAvailable}
              result={askResult}
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
              <Input
                value={formatList(draft.aliases)}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    aliases: parseList(event.target.value),
                  }))
                }
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
              <Input
                value={formatList(draft.tags)}
                onChange={(event) =>
                  onUpdateTable(tableId, (current) => ({
                    ...current,
                    tags: parseList(event.target.value),
                  }))
                }
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
                      <Input
                        value={formatList(columnDraft.aliases)}
                        onChange={(event) =>
                          onUpdateColumn(tableId, column.id, (current) => ({
                            ...current,
                            aliases: parseList(event.target.value),
                          }))
                        }
                      />
                    </FieldWithSuggest>
                    <Field label="Enum notes">
                      <Input
                        value={formatList(columnDraft.enum)}
                        onChange={(event) =>
                          onUpdateColumn(tableId, column.id, (current) => ({
                            ...current,
                            enum: parseList(event.target.value),
                          }))
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

function AskPanel({
  busy,
  message,
  mode,
  onAsk,
  onGoToRag,
  onModeChange,
  onQuestionChange,
  question,
  ragAvailable,
  result,
}: {
  busy: Set<string>;
  message: StatusMessage | null;
  mode: "full" | "rag";
  onAsk: () => Promise<void>;
  onGoToRag: () => void;
  onModeChange: (mode: "full" | "rag") => void;
  onQuestionChange: (question: string) => void;
  question: string;
  ragAvailable: boolean;
  result: AskResponse | null;
}) {
  const ragDisabledReason = "Build the RAG index first to query with retrieval.";
  return (
    <div className="grid gap-0">
      <Panel title="Sample SQL">
        <div className="grid gap-3">
          <Field label="Question">
            <Textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="How many users placed orders?"
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
                className={cn(mode === "full" && "active")}
                type="button"
                onClick={() => onModeChange("full")}
              >
                Full schema
              </button>
              <button
                aria-disabled={!ragAvailable}
                aria-describedby={!ragAvailable ? "ask-rag-disabled-reason" : undefined}
                className={cn(mode === "rag" && "active")}
                disabled={!ragAvailable}
                title={!ragAvailable ? ragDisabledReason : undefined}
                type="button"
                onClick={() => onModeChange("rag")}
              >
                <span className="inline-flex items-center gap-1.5">
                  {!ragAvailable ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  RAG
                </span>
              </button>
            </div>
            {!ragAvailable ? (
              <div
                className="rag-unavailable-hint"
                id="ask-rag-disabled-reason"
                role="note"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  RAG retrieval is unavailable — no index has been built yet.{" "}
                  <button
                    className="link-button"
                    type="button"
                    onClick={onGoToRag}
                  >
                    Open the RAG tab
                  </button>{" "}
                  to build one.
                </span>
              </div>
            ) : null}
          </div>
          <Button disabled={busy.has("ask")} onClick={() => void onAsk()}>
            {busy.has("ask") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate SQL
          </Button>
          {message ? <InlineStatus status={message} /> : null}
        </div>
      </Panel>

      <Panel title="Generated SQL" action={result?.sql ? <CopyButton value={result.sql} /> : undefined}>
        {result?.sql ? <pre className="sql-block">{result.sql}</pre> : <EmptyText text="No SQL generated yet." />}
      </Panel>

      <UsageSummary title="Request Usage" usage={result?.usage ?? null} />

      {result?.explain !== null && result?.explain !== undefined ? (
        <Panel title="Explain">
          <pre className="plain-block">{formatUnknown(result.explain)}</pre>
        </Panel>
      ) : null}

      {result?.warnings && result.warnings.length > 0 ? (
        <Panel title="Warnings">
          <div className="grid gap-2">
            {result.warnings.map((warning, index) => (
              <pre className="warning-block" key={index}>
                {formatUnknown(warning)}
              </pre>
            ))}
          </div>
        </Panel>
      ) : null}

      {result?.rag.enabled ? (
        <ChunkList chunks={result.rag.chunks} emptyText="RAG returned no chunks." />
      ) : null}
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
      <Panel title="RAG Files">
        {ragStatus ? (
          <dl className="definition-list">
            <dt>Lock file</dt>
            <dd>{ragStatus.files.lock ? "present" : "missing"}</dd>
            <dt>Embeddings JSON</dt>
            <dd>{ragStatus.files.embeddingsJson ? "present" : "missing"}</dd>
            <dt>Embeddings binary</dt>
            <dd>{ragStatus.files.embeddingsBin ? "present" : "missing"}</dd>
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

function formatList(list: string[] | undefined): string {
  return list?.join(", ") ?? "";
}

function formatUsageInline(usage: StudioRequestUsageDto | null): string {
  const tokens = usage?.totalTokens ?? usage?.embeddingTokens ?? null;
  return tokens === null ? "" : `, ${formatNumber(tokens)} tokens`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function applyTableSuggestion(draft: TableDraft, field: string, text: string): TableDraft {
  if (field === "aliases" || field === "tags") return { ...draft, [field]: parseList(text) };
  return { ...draft, [field]: text };
}

function applyColumnSuggestion(draft: ColumnDraft, field: string, text: string): ColumnDraft {
  if (field === "aliases" || field === "enum") return { ...draft, [field]: parseList(text) };
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
