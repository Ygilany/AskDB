import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { ThemeProvider } from "./contexts/theme-context";
import { WorkspaceProvider, useWorkspace } from "./contexts/workspace-context";
import { RagProvider, useRag } from "./contexts/rag-context";
import { PlaygroundProvider } from "./contexts/playground-context";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "./components/ui/sidebar";
import { Topbar } from "./components/shell/Topbar";
import { NavRail } from "./components/shell/NavRail";
import { SuggestionDialog } from "./components/common/SuggestionDialog";
import { OverviewPage } from "./views/overview/OverviewPage";
import { TablesLayout } from "./views/tables/TablesLayout";
import { TableDetail } from "./views/tables/TableDetail";
import { EnrichmentTab } from "./views/tables/EnrichmentTab";
import { SchemaTab } from "./views/tables/SchemaTab";
import { SensitivityTab } from "./views/tables/SensitivityTab";
import { ConceptsPage } from "./views/concepts/ConceptsPage";
import { TenancyPage } from "./views/tenancy/TenancyPage";
import { RagIndexPage } from "./views/rag-index/RagIndexPage";
import { PlaygroundPage } from "./views/playground/PlaygroundPage";
import { SettingsPage } from "./views/settings/SettingsPage";
import { Separator } from "./components/ui/separator";

export function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <RagProvider>
          <AppShell />
        </RagProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}

function AppShell() {
  const { load, loadState, suggestionDialog, setSuggestionDialog, applySuggestion } = useWorkspace();
  const { refreshRagStatus, ragAvailable } = useRag();

  useEffect(() => {
    void load().then(() => void refreshRagStatus());
  }, [load]);

  if (loadState.kind === "loading") {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--ink-400)", fontSize: 13 }}>Loading workspace…</p>
      </div>
    );
  }

  if (loadState.kind === "error") {
    return (
      <div className="app-shell" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--red-600)", fontWeight: 600, marginBottom: 8 }}>Failed to load workspace</p>
          <p style={{ color: "var(--ink-400)", fontSize: 13 }}>{loadState.message}</p>
        </div>
      </div>
    );
  }

  return (
    <PlaygroundProvider ragAvailable={ragAvailable}>
      <SidebarProvider
        defaultOpen={true}
        className="!min-h-0 h-svh"
        style={{
          "--sidebar-width": "var(--nav-w)",
        } as React.CSSProperties}
      >
        <NavRail />
        <SidebarInset className="min-h-0 overflow-hidden">
          <header className="topbar">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 !h-4" />
            <Topbar />
          </header>
          <div className="app-content">
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/tables" element={<TablesLayout />}>
                <Route path=":schema/:name" element={<TableDetail />}>
                  <Route index element={<Navigate to="enrichment" replace />} />
                  <Route path="enrichment" element={<EnrichmentTab />} />
                  <Route path="schema" element={<SchemaTab />} />
                  <Route path="sensitivity" element={<SensitivityTab />} />
                </Route>
              </Route>
              <Route path="/concepts" element={<ConceptsPage />} />
              <Route path="/tenancy" element={<TenancyPage />} />
              <Route path="/rag-index" element={<RagIndexPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </SidebarInset>
      </SidebarProvider>

      {suggestionDialog && (
        <SuggestionDialog
          dialog={suggestionDialog}
          onApply={applySuggestion}
          onClose={() => setSuggestionDialog(null)}
        />
      )}
    </PlaygroundProvider>
  );
}
