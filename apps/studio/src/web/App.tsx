import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBanner } from "./components/common/StatusBanner";
import { SuggestionDialog } from "./components/common/SuggestionDialog";
import { Button } from "./components/ui";
import { useAsk } from "./features/ask/useAsk";
import { InspectorPanel } from "./features/inspector/InspectorPanel";
import { useRag } from "./features/rag/useRag";
import { TableEditor } from "./features/workspace/TableEditor";
import { WorkspaceHeader } from "./features/workspace/WorkspaceHeader";
import { WorkspaceSidebar } from "./features/workspace/WorkspaceSidebar";
import { useWorkspace } from "./features/workspace/useWorkspace";
import { getErrorMessage } from "./lib/format";

type LoadState = {
  kind: "loading" | "ready" | "error";
  message?: string;
};

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const rag = useRag();
  const workspace = useWorkspace({ onAfterSave: rag.refreshRagStatus });
  const ask = useAsk({ ragAvailable: rag.ragAvailable });

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoadState({ kind: "loading" });
    try {
      await Promise.all([workspace.load(), rag.load()]);
      setLoadState({ kind: "ready" });
    } catch (error) {
      setLoadState({ kind: "error", message: getErrorMessage(error) });
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

  if (loadState.kind === "error" || !workspace.workspace) {
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
      <WorkspaceSidebar
        workspace={workspace.workspace}
        filteredTables={workspace.filteredTables}
        selectedTable={workspace.selectedTable}
        setSelectedTableId={workspace.setSelectedTableId}
        tableSearch={workspace.tableSearch}
        setTableSearch={workspace.setTableSearch}
      />

      <main className="studio-main">
        <WorkspaceHeader
          workspace={workspace.workspace}
          selectedTable={workspace.selectedTable}
          dirty={workspace.dirty}
          isSaving={workspace.isSaving}
          onSave={() => void workspace.saveSelectedTable()}
          onRevert={workspace.resetSelectedDraft}
        />

        {workspace.saveStatus ? <StatusBanner status={workspace.saveStatus} /> : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {workspace.selectedTable && workspace.selectedDraft ? (
            <TableEditor
              aiConfigured={workspace.workspace.aiConfigured}
              draft={workspace.selectedDraft}
              onRequestSuggestion={workspace.requestSuggestion}
              onUpdateColumn={workspace.updateColumnDraft}
              onUpdateTable={workspace.updateTableDraft}
              suggestingKey={workspace.suggestingKey}
              table={workspace.selectedTable}
            />
          ) : (
            <div className="p-8 text-sm text-muted-foreground">
              No tables found in this schema.
            </div>
          )}
        </div>
      </main>

      <InspectorPanel ask={ask} rag={rag} workspace={workspace.workspace} />

      {workspace.suggestionDialog ? (
        <SuggestionDialog
          dialog={workspace.suggestionDialog}
          onApply={workspace.applySuggestion}
          onClose={workspace.closeSuggestionDialog}
        />
      ) : null}
    </div>
  );
}
