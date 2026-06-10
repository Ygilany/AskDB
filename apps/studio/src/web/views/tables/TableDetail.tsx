import { NavLink, Outlet } from "react-router";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { StatusBanner } from "../../components/common/StatusBanner";

export function TableDetail() {
  const { selectedTable, selectedDraft, dirty, saveStatus, saveSelectedTable, resetSelectedDraft, busy } = useWorkspace();
  const { refreshRagStatus } = useRag();

  if (!selectedTable || !selectedDraft) return null;

  async function handleSave() {
    await saveSelectedTable();
    void refreshRagStatus();
  }

  const t = selectedTable;
  const hasSome = selectedDraft.description || (selectedDraft.aliases && selectedDraft.aliases.length > 0);
  const allCols = Object.values(selectedDraft.columns ?? {}).every((c) => c.description);
  const level = hasSome && allCols ? "enriched" : hasSome ? "partial" : "none";

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1>
            <span className={`enrich-dot ${level}`} style={{ marginRight: 8 }} />
            {t.physical.schema}.{t.physical.name}
          </h1>
          <div className="main-sub">
            {t.physical.columns.length} columns
            {t.physical.relationships && t.physical.relationships.length > 0
              ? ` · ${t.physical.relationships.length} relationships`
              : ""}
            {t.missingColumnIds.length > 0 ? ` · ${t.missingColumnIds.length} missing` : ""}
          </div>
        </div>
        <div className="main-actions">
          <button
            type="button"
            className="btn"
            onClick={resetSelectedDraft}
            disabled={!dirty || busy.has("save")}
          >
            <RotateCcw size={14} /> Revert
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={!dirty || busy.has("save")}
          >
            {busy.has("save") ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>

      {saveStatus && <StatusBanner status={saveStatus} />}

      <div className="sub-tabs">
        <NavLink
          to="enrichment"
          className={({ isActive }) => `sub-tab ${isActive ? "active" : ""}`}
        >
          Enrichment
        </NavLink>
        <NavLink
          to="schema"
          className={({ isActive }) => `sub-tab ${isActive ? "active" : ""}`}
        >
          Schema
        </NavLink>
        <NavLink
          to="sensitivity"
          className={({ isActive }) => `sub-tab ${isActive ? "active" : ""}`}
        >
          Sensitivity
        </NavLink>
      </div>

      <div className="main-body">
        <Outlet />
      </div>
    </main>
  );
}
