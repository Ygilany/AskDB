import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { Search, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";

export function TablesLayout() {
  const navigate = useNavigate();
  const params = useParams<{ schema: string; name: string }>();
  const {
    filteredTables,
    tables,
    selectedTable,
    setSelectedTableId,
    tableSearch,
    setTableSearch,
    drafts,
  } = useWorkspace();

  useEffect(() => {
    if (params.schema && params.name) {
      const id = `table:${params.schema}.${params.name}`;
      setSelectedTableId(id);
    } else if (tables.length > 0 && !params.schema) {
      const first = tables[0];
      navigate(`/tables/${first.physical.schema}/${first.physical.name}/enrichment`, { replace: true });
    }
  }, [params.schema, params.name, tables]);

  const hasOutlet = Boolean(params.schema && params.name);

  return (
    <>
      <div className="sub-rail">
        <div className="sub-rail-hd">
          <h2>Tables</h2>
          <span className="muted tiny">{tables.length} tables</span>
        </div>
        <div className="sub-rail-search">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search tables…"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
          />
        </div>
        <div className="sub-rail-list">
          {filteredTables.map((t) => {
            const draft = drafts[t.physical.id] ?? t.draft;
            const hasSome = draft.description || (draft.aliases && draft.aliases.length > 0);
            const allCols = Object.values(draft.columns ?? {}).every((c) => c.description);
            const level = hasSome && allCols ? "enriched" : hasSome ? "partial" : "none";
            const isActive = selectedTable?.physical.id === t.physical.id;
            return (
              <button
                key={t.physical.id}
                className={`sub-rail-row ${isActive ? "active" : ""}`}
                onClick={() => navigate(`/tables/${t.physical.schema}/${t.physical.name}/enrichment`)}
              >
                <span className={`enrich-dot ${level}`} />
                <span className="row-name mono">{t.physical.schema}.{t.physical.name}</span>
                <span className="row-meta">{t.physical.columns.length} cols</span>
              </button>
            );
          })}
          {filteredTables.length === 0 && (
            <div className="muted tiny" style={{ padding: "16px", textAlign: "center" }}>
              No tables match your search
            </div>
          )}
        </div>
      </div>
      {hasOutlet ? (
        <Outlet />
      ) : (
        <main className="main-pane">
          <div className="main-body" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "var(--ink-400)" }}>
              <Sparkles size={24} style={{ margin: "0 auto 8px" }} />
              <p style={{ fontSize: 13 }}>Select a table to start enriching</p>
            </div>
          </div>
        </main>
      )}
    </>
  );
}
